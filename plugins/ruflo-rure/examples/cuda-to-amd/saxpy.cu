// Trusted acceptance workload: every output checked against an independent CPU result.
#include <cuda_runtime.h>
#include <cstdio>
#include <cstdlib>
#include <cmath>
#include <vector>
#include <algorithm>
#define CHECK(call) do { auto e=(call); if(e!=cudaSuccess) { std::fprintf(stderr,"GPU error: %s\n",cudaGetErrorString(e)); return 2; } } while(0)
__global__ void saxpy(int n, float a, const float* x, float* y) {
  int i=blockIdx.x*blockDim.x+threadIdx.x;
  if(i<n) y[i]=a*x[i]+y[i];
}
int main(int argc,char** argv) {
  if(argc!=3) return 2;
  int n=std::atoi(argv[1]), block=std::atoi(argv[2]);
  if(n<1 || n>16777216 || block<32 || block>1024) return 2;
  cudaDeviceProp prop; CHECK(cudaGetDeviceProperties(&prop,0));
  std::vector<float> x(n), y(n), reference(n);
  for(int i=0;i<n;i++) { x[i]=float((i%251)-125)/128; y[i]=float((i%127)-63)/64; reference[i]=2*x[i]+y[i]; }
  float *dx,*dy; CHECK(cudaMalloc(&dx,n*sizeof(float))); CHECK(cudaMalloc(&dy,n*sizeof(float)));
  CHECK(cudaMemcpy(dx,x.data(),n*sizeof(float),cudaMemcpyHostToDevice));
  CHECK(cudaMemcpy(dy,y.data(),n*sizeof(float),cudaMemcpyHostToDevice));
  // Warm this process/context, then restore the input before measurement.
  saxpy<<<(n+block-1)/block,block>>>(n,2,dx,dy);
  CHECK(cudaGetLastError()); CHECK(cudaDeviceSynchronize());
  CHECK(cudaMemcpy(dy,y.data(),n*sizeof(float),cudaMemcpyHostToDevice));
  cudaEvent_t start,stop; CHECK(cudaEventCreate(&start)); CHECK(cudaEventCreate(&stop));
  std::vector<float> timings;
  double error=0;
  // Repeated measurements share one context. Transfers and CPU checks are outside events.
  for(int repeat=0;repeat<32;repeat++) {
    CHECK(cudaMemcpy(dy,y.data(),n*sizeof(float),cudaMemcpyHostToDevice));
    CHECK(cudaEventRecord(start));
    saxpy<<<(n+block-1)/block,block>>>(n,2,dx,dy);
    CHECK(cudaGetLastError()); CHECK(cudaEventRecord(stop)); CHECK(cudaEventSynchronize(stop));
    float elapsed; CHECK(cudaEventElapsedTime(&elapsed,start,stop)); timings.push_back(elapsed);
    std::vector<float> actual(n);
    CHECK(cudaMemcpy(actual.data(),dy,n*sizeof(float),cudaMemcpyDeviceToHost));
    for(int i=0;i<n;i++) { if(!std::isfinite(actual[i])) return 3; error=std::fmax(error,std::fabs(double(actual[i])-reference[i])); }
  }
  std::sort(timings.begin(),timings.end());
  float ms=(timings[15]+timings[16])/2;
  CHECK(cudaFree(dx)); CHECK(cudaFree(dy)); CHECK(cudaEventDestroy(start)); CHECK(cudaEventDestroy(stop));
#ifdef __HIP_PLATFORM_AMD__
  const char* backend="hip";
#else
  const char* backend="cuda";
#endif
  // Escape device name for JSON.
  std::printf("{\"backend\":\"%s\",\"device\":\"",backend);
  for(const char* p=prop.name;*p;p++) { if(*p=='"' || *p=='\\') std::putchar('\\'); if((unsigned char)*p>=32) std::putchar(*p); }
  std::printf("\",\"size\":%d,\"checked\":%d,\"max_abs_error\":%.9g,\"milliseconds\":%.9g,\"inner_samples\":32}\n",n,n,error,ms);
  return 0;
}
