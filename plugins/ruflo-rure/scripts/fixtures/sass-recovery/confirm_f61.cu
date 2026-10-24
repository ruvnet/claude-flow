#include <stdint.h>
extern "C" __global__ void confirm_f61(uint64_t input, uint64_t aux, uint64_t output, uint32_t count, uint64_t scalar) {
  uint32_t i = blockIdx.x * blockDim.x + threadIdx.x;
  if (i >= count) return;
  const uint64_t* x = reinterpret_cast<const uint64_t*>(input);
  const uint64_t* y = reinterpret_cast<const uint64_t*>(aux);
  uint64_t* z = reinterpret_cast<uint64_t*>(output);
  z[i] = x[i] * x[i] + y[i] * scalar;
}
