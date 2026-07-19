#ifdef __cplusplus
#import "react-native-bs-diff-patch.h"
#endif

#ifdef RCT_NEW_ARCH_ENABLED
#import "RNBsDiffPatchSpec.h"
#import <React/RCTEventEmitter.h>

@interface BsDiffPatch : RCTEventEmitter <NativeBsDiffPatchSpec>
#else
#import <React/RCTEventEmitter.h>

@interface BsDiffPatch : RCTEventEmitter <RCTBridgeModule>
#endif

@end
