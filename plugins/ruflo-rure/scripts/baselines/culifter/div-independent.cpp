#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <vector>
#include <limits>
extern "C" {
alignas(8) thread_local uint8_t const_mem[5][4096] = {};
alignas(16) thread_local uint8_t local_mem[32768] = {};
alignas(16) uint8_t shared_mem[32768] = {};
void B28c_int_div_pow2();
}
template<class T> static void set(unsigned offset, T value) {
  memcpy(&const_mem[0][offset], &value, sizeof(value));
}
int main() {
  const uint32_t sizes[]={0,1,31,32,33,127,129,257,1025};
  uint64_t comparisons=0;
  for (uint32_t n:sizes) {
    std::vector<uint32_t> input(n+32), output(n+32,0xa5a5a5a5U);
    uint32_t state=0x5eede11U;
    for (unsigned i=0;i<input.size();++i) {state=1664525U*state+1013904223U;input[i]=state;}
    if(n>0) input[0]=0; if(n>1)input[1]=0xffffffffU; if(n>2)input[2]=0x80000000U;
    set(0x210, uint64_t(uintptr_t(input.data())));
    set(0x218, uint64_t(uintptr_t(output.data())));
    set(0x220, n);
    set(0, uint32_t(128));
    for(uint32_t block=0;block<(n+127)/128+1;++block) {
      set(32,block);
      for(uint32_t thread=0;thread<128;++thread) {set(44,thread);B28c_int_div_pow2();}
    }
    for(unsigned i=0;i<output.size();++i) {
      uint32_t expected=i<n?uint32_t(input[i]/8U + (input[i]>>3)):0xa5a5a5a5U;
      ++comparisons;
      if(output[i]!=expected) {printf("{\"status\":\"fail\",\"n\":%u,\"index\":%u,\"expected\":%u,\"actual\":%u}\n",n,i,expected,output[i]);return 1;}
    }
  }
  printf("{\"status\":\"pass\",\"kernels\":1,\"cases\":9,\"comparisons\":%llu,\"guard_elements_per_case\":32}\n",(unsigned long long)comparisons);
}
