#include <stdint.h>
extern "C" __global__ void confirm_e43(uint64_t input, uint64_t aux, uint64_t output, uint32_t count, uint64_t scalar) {
  uint32_t i = blockIdx.x * blockDim.x + threadIdx.x;
  if (i >= count) return;
  const uint32_t* x = reinterpret_cast<const uint32_t*>(input);
  const uint32_t* y = reinterpret_cast<const uint32_t*>(aux);
  uint64_t* z = reinterpret_cast<uint64_t*>(output);
  z[i] = uint64_t(uint32_t(x[i] + y[i])) * uint64_t(13) + scalar;
}
