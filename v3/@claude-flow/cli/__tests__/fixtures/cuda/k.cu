#include <cstdio>
__global__ void saxpy(int n, float a, const float* x, float* y) { int i = blockIdx.x*blockDim.x + threadIdx.x; if (i < n) y[i] = a*x[i] + y[i]; }
__global__ void scale_secret(float* v, int n) { int i = threadIdx.x; if (i < n) v[i] *= 31337.0f; }
int main() { float *x,*y; cudaMalloc(&x,4096); cudaMalloc(&y,4096); saxpy<<<4,256>>>(1024,2.0f,x,y); scale_secret<<<1,256>>>(y,256); cudaDeviceSynchronize(); puts("done"); return 0; }
