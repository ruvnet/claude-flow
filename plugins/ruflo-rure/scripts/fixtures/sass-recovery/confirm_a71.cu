#include <stdint.h>
extern "C" __global__ void confirm_a71(uint64_t input, uint64_t aux, uint64_t output, uint32_t count, uint64_t scalar) {
  uint32_t i = blockIdx.x * blockDim.x + threadIdx.x;
  if (i >= count) return;
  const uint32_t* x = reinterpret_cast<const uint32_t*>(input);
  const uint32_t* y = reinterpret_cast<const uint32_t*>(aux);
  uint32_t* z = reinterpret_cast<uint32_t*>(output);
  z[i] = x[i] * uint32_t(19) + y[i] + uint32_t(scalar);
}
