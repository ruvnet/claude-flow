#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <vector>
extern "C" {
alignas(8) thread_local uint8_t const_mem[5][4096] = {};
alignas(16) thread_local uint8_t local_mem[32768] = {};
alignas(16) uint8_t shared_mem[32768] = {};
void A5_two_input();
}
template<class T> static void set(unsigned offset,T value){memcpy(&const_mem[0][offset],&value,sizeof(value));}
int main(){
  const uint32_t sizes[]={0,1,31,32,33,127,129,257,1025};uint64_t comparisons=0;
  for(uint32_t n:sizes){
    std::vector<float> a(n+32),b(n+32),out(n+32,-12345.0f);
    for(unsigned i=0;i<a.size();++i){a[i]=float(int(i%100)-50)*0.25f;b[i]=float(int(i%23)-11)*0.5f;}
    set(0x210,uint64_t(uintptr_t(a.data())));set(0x218,uint64_t(uintptr_t(b.data())));set(0x220,uint64_t(uintptr_t(out.data())));set(0x228,n);set(0,uint32_t(128));
    for(uint32_t block=0;block<(n+127)/128+1;++block){set(32,block);for(uint32_t thread=0;thread<128;++thread){set(44,thread);A5_two_input();}}
    for(unsigned i=0;i<out.size();++i){float expected=i<n?a[i]+b[i]:-12345.0f;++comparisons;if(out[i]!=expected){printf("{\"status\":\"fail\",\"n\":%u,\"index\":%u,\"expected\":%.9g,\"actual\":%.9g}\n",n,i,expected,out[i]);return 1;}}
  }
  printf("{\"status\":\"pass\",\"kernels\":1,\"cases\":9,\"comparisons\":%llu,\"guard_elements_per_case\":32,\"floating_scope\":\"finite exactly representable dyadic values only\"}\n",(unsigned long long)comparisons);
}
