// Source-known CUDA Driver API oracle: JITs the explicitly supplied PTX fixtures.
// Run only the frozen public test inputs on an authorized isolated GPU host.
// nvcc -std=c++17 ptx-gpu-validate.cu -lcuda -o ptx-gpu-validate
// ./ptx-gpu-validate original.ptx reconstructed.ptx
#include <cuda.h>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <iterator>
#include <string>
#include <vector>

static void check(CUresult r, const char* operation) {
  if (r != CUDA_SUCCESS) {
    const char* name = nullptr;
    cuGetErrorName(r, &name);
    std::fprintf(stderr, "%s: %s\n", operation, name ? name : "CUDA_ERROR");
    std::exit(1);
  }
}
#define CU(call) check((call), #call)

static CUmodule load(const char* path) {
  std::ifstream file(path);
  if (!file) { std::fprintf(stderr, "Cannot read PTX\n"); std::exit(1); }
  std::string ptx((std::istreambuf_iterator<char>(file)), std::istreambuf_iterator<char>());
  CUmodule module;
  CU(cuModuleLoadData(&module, ptx.c_str()));
  return module;
}

int main(int argc, char** argv) {
  if (argc != 3) { std::fprintf(stderr, "usage: ptx-gpu-validate original.ptx reconstructed.ptx\n"); return 2; }
  CU(cuInit(0));
  CUdevice device;
  CU(cuDeviceGet(&device, 0));
  CUcontext context;
  CU(cuCtxCreate(&context, 0, device));
  char gpu[256] = {};
  CU(cuDeviceGetName(gpu, sizeof(gpu), device));
  int driver = 0;
  CU(cuDriverGetVersion(&driver));
  CUmodule original = load(argv[1]);
  CUmodule reconstructed = load(argv[2]);
  size_t cases = 0, elements = 0;
  for (const char* kernel : {"affine_i32", "sum_i32"}) {
    CUfunction a, b;
    CU(cuModuleGetFunction(&a, original, kernel));
    CU(cuModuleGetFunction(&b, reconstructed, kernel));
    for (int n : {0, 1, 31, 32, 33, 127, 129, 257, 1025}) {
      const size_t capacity = static_cast<size_t>(n) + 17;
      std::vector<int32_t> input(capacity), expected(capacity, -1234567), first(capacity), second(capacity);
      for (size_t i = 0; i < capacity; ++i) input[i] = static_cast<int32_t>((i * 17 + 11) % 47) - 9;
      for (int i = 0; i < n; ++i) {
        if (kernel[0] == 'a') expected[i] = input[i] * 3 + 7;
        else { int32_t sum = 0; for (int j = 0; j < input[i]; ++j) sum += j; expected[i] = sum; }
      }
      const size_t bytes = capacity * sizeof(int32_t);
      CUdeviceptr x, y;
      CU(cuMemAlloc(&x, bytes)); CU(cuMemAlloc(&y, bytes));
      CU(cuMemcpyHtoD(x, input.data(), bytes));
      for (int variant = 0; variant < 2; ++variant) {
        std::vector<int32_t> initial(capacity, -1234567);
        CU(cuMemcpyHtoD(y, initial.data(), bytes));
        void* params[] = {&x, &y, &n};
        // Always launch, including n=0, so the guard and untouched tail are tested.
        CU(cuLaunchKernel(variant == 0 ? a : b, (n + 127) / 128 + 1, 1, 1, 128, 1, 1, 0, nullptr, params, nullptr));
        CU(cuCtxSynchronize());
        auto& result = variant == 0 ? first : second;
        CU(cuMemcpyDtoH(result.data(), y, bytes));
        for (size_t i = 0; i < capacity; ++i) {
          if (result[i] != expected[i]) {
            std::fprintf(stderr, "mismatch kernel=%s n=%d index=%zu variant=%d expected=%d actual=%d\n", kernel, n, i, variant, expected[i], result[i]);
            return 1;
          }
        }
      }
      if (first != second) return 1;
      CU(cuMemFree(x)); CU(cuMemFree(y));
      ++cases; elements += capacity * 2;
    }
  }
  CU(cuModuleUnload(original)); CU(cuModuleUnload(reconstructed)); CU(cuCtxDestroy(context));
  std::printf("{\"status\":\"pass\",\"claim\":\"PTX instruction-IR roundtrip on frozen integer kernels\",\"cases\":%zu,\"element_comparisons\":%zu,\"driver\":%d,\"gpu\":\"%s\"}\n", cases, elements, driver, gpu);
  return 0;
}
