#ifdef __cplusplus
#import "react-native-bs-diff-patch.h"
#endif

#ifdef RCT_NEW_ARCH_ENABLED
#import "RNBsDiffPatchSpec.h"

@interface BsDiffPatch : NSObject <NativeBsDiffPatchSpec>
#else
#import <React/RCTBridgeModule.h>

@interface BsDiffPatch : NSObject <RCTBridgeModule>
#endif

@end
