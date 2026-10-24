// Independent Driver API validator. Every recovered.ptx must have been compiled
// from the corresponding recovered.cu by nvcc, never copied from original.ptx.
// nvcc -std=c++17 ptx-recovery-gpu.cu -lcuda -o ptx-recovery-gpu
// ./ptx-recovery-gpu /absolute/path/to/frozen-bundle
// Inputs are public synthetic integer programs; run on an isolated GPU only.
#include <cuda.h>
#include <stdint.h>
#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <iterator>
#include <sstream>
#include <string>
#include <vector>

struct Timing { std::string id; std::vector<double> samples[2]; };

static double percentile(const std::vector<double>& values, unsigned percentile) {
  auto sorted = values; std::sort(sorted.begin(), sorted.end());
  return sorted[(sorted.size() * percentile + 99) / 100 - 1];
}

static void printSamples(const std::vector<double>& values) {
  std::printf("[");
  for (size_t i = 0; i < values.size(); i++) std::printf("%s%.6f", i ? "," : "", values[i]);
  std::printf("]");
}

static void checked(CUresult result, const char* expression) {
  if (result != CUDA_SUCCESS) {
    const char* name = nullptr;
    cuGetErrorName(result, &name);
    std::fprintf(stderr, "%s: %s\n", expression, name ? name : "CUDA_ERROR");
    std::exit(2);
  }
}
#define CU(expr) checked((expr), #expr)

static std::vector<char> read(const std::string& path, size_t expected = 0) {
  std::ifstream file(path, std::ios::binary);
  if (!file) { std::fprintf(stderr, "cannot open %s\n", path.c_str()); std::exit(2); }
  std::vector<char> data((std::istreambuf_iterator<char>(file)), {});
  if ((expected && data.size() != expected) || data.size() > 4 * 1024 * 1024) {
    std::fprintf(stderr, "invalid bounded input size %s\n", path.c_str()); std::exit(2);
  }
  return data;
}

static CUmodule load(const std::string& path) {
  auto data = read(path); data.push_back(0);
  CUmodule module; CU(cuModuleLoadData(&module, data.data())); return module;
}

static bool safe(const std::string& name) {
  if (name.empty() || name.size() > 128) return false;
  for (char c : name) if (!(c >= 'a' && c <= 'z') && !(c >= 'A' && c <= 'Z') && !(c >= '0' && c <= '9') && c != '_') return false;
  return true;
}

int main(int argc, char** argv) {
  if (argc != 2) { std::fprintf(stderr, "usage: ptx-recovery-gpu frozen-bundle-directory\n"); return 2; }
  const std::string root = argv[1];
  std::ifstream list(root + "/kernels.txt");
  if (!list) return 2;
  CU(cuInit(0)); CUdevice device; CU(cuDeviceGet(&device, 0));
  CUcontext context;
#if CUDA_VERSION >= 13000
  // CUDA 13 adds context creation parameters. A zero-initialized structure
  // requests an ordinary context, as in NVIDIA's threadMigration sample.
  CUctxCreateParams contextParameters{};
  CU(cuCtxCreate(&context, &contextParameters, 0, device));
#else
  CU(cuCtxCreate(&context, 0, device));
#endif
  char gpu[256] = {}; CU(cuDeviceGetName(gpu, sizeof(gpu), device));
  int driver = 0; CU(cuDriverGetVersion(&driver));
  size_t kernels = 0, cases = 0, comparisons = 0;
  std::vector<Timing> timings;
  std::string id;
  while (std::getline(list, id)) {
    if (!safe(id) || ++kernels > 100) return 2;
    const std::string dir = root + "/" + id;
    std::ifstream info(dir + "/case.txt");
    std::string originalName, recoveredName; unsigned inputBits, outputBits;
    if (!(info >> originalName >> recoveredName >> inputBits >> outputBits) || !safe(originalName) || !safe(recoveredName) || (inputBits != 32 && inputBits != 64) || (outputBits != 32 && outputBits != 64)) return 2;
    CUmodule modules[] = {load(dir + "/original.ptx"), load(dir + "/recovered.ptx")};
    CUfunction functions[2];
    CU(cuModuleGetFunction(&functions[0], modules[0], originalName.c_str()));
    CU(cuModuleGetFunction(&functions[1], modules[1], recoveredName.c_str()));
    uint32_t count; size_t kernelCases = 0;
    while (info >> count) {
      if (count > 4096 || ++kernelCases > 100) return 2;
      const size_t capacity = count + 8, inputBytes = capacity * (inputBits / 8), outputBytes = capacity * (outputBits / 8);
      const std::string prefix = dir + "/n" + std::to_string(count);
      const auto input = read(prefix + ".input.bin", inputBytes), aux = read(prefix + ".aux.bin", inputBytes), expected = read(prefix + ".expected.bin", outputBytes);
      std::vector<char> output(outputBytes), initial(outputBytes, static_cast<char>(0xa5));
      CUdeviceptr x, y, z;
      CU(cuMemAlloc(&x, inputBytes)); CU(cuMemAlloc(&y, inputBytes)); CU(cuMemAlloc(&z, outputBytes));
      CU(cuMemcpyHtoD(x, input.data(), inputBytes)); CU(cuMemcpyHtoD(y, aux.data(), inputBytes));
      uint64_t scalar = 0;
      for (int variant = 0; variant < 2; variant++) {
        CU(cuMemcpyHtoD(z, initial.data(), outputBytes));
        void* parameters[] = {&x, &y, &z, &count, &scalar};
        // Extra block including count=0 verifies the bounds guard and sentinels.
        CU(cuLaunchKernel(functions[variant], (count + 7) / 8 + 1, 1, 1, 8, 1, 1, 0, nullptr, parameters, nullptr));
        CU(cuCtxSynchronize()); CU(cuMemcpyDtoH(output.data(), z, outputBytes));
        for (size_t offset = 0; offset < outputBytes; offset++) {
          if (output[offset] != expected[offset]) {
            std::fprintf(stderr, "mismatch kernel=%s count=%u variant=%d byte=%zu expected=%u actual=%u\n", id.c_str(), count, variant, offset, static_cast<unsigned char>(expected[offset]), static_cast<unsigned char>(output[offset]));
            CU(cuMemFree(x)); CU(cuMemFree(y)); CU(cuMemFree(z));
            CU(cuModuleUnload(modules[0])); CU(cuModuleUnload(modules[1])); CU(cuCtxDestroy(context));
            return 1;
          }
        }
        comparisons += capacity;
      }
      // Frozen timing protocol, separate from correctness: count=65 only, ten
      // warmups then 100 paired samples per variant. Pair order alternates to
      // reduce fixed-order bias. Includes host launch plus synchronous completion;
      // excludes module loading, allocation, reference generation and transfers.
      // Inputs are the same public synthetic arrays, not a representative workload.
      if (count == 65) {
        Timing timing; timing.id = id;
        void* parameters[] = {&x, &y, &z, &count, &scalar};
        for (int pair = -10; pair < 100; pair++) {
          for (int order = 0; order < 2; order++) {
            const int variant = ((pair + 10) % 2 + order) % 2;
            const auto start = std::chrono::steady_clock::now();
            CU(cuLaunchKernel(functions[variant], (count + 7) / 8 + 1, 1, 1, 8, 1, 1, 0, nullptr, parameters, nullptr));
            CU(cuCtxSynchronize());
            const auto end = std::chrono::steady_clock::now();
            if (pair >= 0) timing.samples[variant].push_back(std::chrono::duration<double, std::micro>(end - start).count());
          }
        }
        CU(cuMemcpyDtoH(output.data(), z, outputBytes));
        if (output != expected) { std::fprintf(stderr, "post-timing mismatch kernel=%s\n", id.c_str()); return 1; }
        timings.push_back(timing);
      }
      CU(cuMemFree(x)); CU(cuMemFree(y)); CU(cuMemFree(z)); cases++;
    }
    if (!info.eof() || kernelCases == 0) return 2;
    CU(cuModuleUnload(modules[0])); CU(cuModuleUnload(modules[1]));
  }
  CU(cuCtxDestroy(context));
  if (kernels == 0) return 2;
  std::printf("{\"status\":\"pass\",\"claim\":\"original PTX and independently compiled recovered CUDA C++ match frozen integer oracle\",\"kernels\":%zu,\"cases\":%zu,\"elementComparisons\":%zu,\"driver\":%d,\"gpu\":\"%s\",\"timing\":{\"unit\":\"microseconds\",\"scope\":\"host cuLaunchKernel plus cuCtxSynchronize at count 65; allocations, transfers and module loading excluded\",\"warmupsPerVariant\":10,\"samplesPerVariant\":100,\"pairOrder\":\"alternating\",\"clocksLocked\":false,\"sotaClaim\":false,\"results\":[", kernels, cases, comparisons, driver, gpu);
  double sumLogRatio = 0; size_t regressions = 0;
  for (size_t i = 0; i < timings.size(); i++) {
    const auto& timing = timings[i];
    const double base = percentile(timing.samples[0], 50), candidate = percentile(timing.samples[1], 50);
    sumLogRatio += std::log(base / candidate);
    if (candidate > base * 1.02) regressions++;
    std::printf("%s{\"id\":\"%s\",\"originalP50\":%.6f,\"originalP95\":%.6f,\"recoveredP50\":%.6f,\"recoveredP95\":%.6f,\"medianSpeedup\":%.9f,\"originalSamples\":", i ? "," : "", timing.id.c_str(), base, percentile(timing.samples[0], 95), candidate, percentile(timing.samples[1], 95), base / candidate);
    printSamples(timing.samples[0]); std::printf(",\"recoveredSamples\":"); printSamples(timing.samples[1]); std::printf("}");
  }
  const double geometricSpeedup = timings.empty() ? 0 : std::exp(sumLogRatio / timings.size());
  std::printf("],\"geometricMeanMedianSpeedup\":%.9f,\"regressionsAbove2Percent\":%zu,\"meetsProposed10PercentAndNoRegressionThreshold\":%s}}\n", geometricSpeedup, regressions, (!timings.empty() && geometricSpeedup >= 1.10 && regressions == 0) ? "true" : "false");
  return 0;
}
