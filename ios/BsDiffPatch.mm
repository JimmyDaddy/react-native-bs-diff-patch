#import "BsDiffPatch.h"

#ifdef RCT_NEW_ARCH_ENABLED
#import <memory>
#import <ReactCommon/RCTTurboModule.h>
#endif

@implementation BsDiffPatch
RCT_EXPORT_MODULE()

+ (BOOL)requiresMainQueueSetup
{
    return NO;
}

- (dispatch_queue_t)methodQueue
{
    static dispatch_queue_t queue;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        queue = dispatch_queue_create("com.jimmydaddy.bsdiffpatch.worker", DISPATCH_QUEUE_SERIAL);
    });
    return queue;
}

// Example method
// See // https://reactnative.dev/docs/native-modules-ios
RCT_EXPORT_METHOD(patch:(NSString*) oldFile
                  newFile:(NSString*) newFile
                  patchFile:(NSString*) patchFile
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
    if (oldFile == nil || oldFile.length == 0 || newFile == nil || newFile.length == 0 || patchFile == nil || patchFile.length == 0) {
        NSString *message = @"oldFile, newFile, and patchFile should not be nil or empty";
        reject(@"EINVAL", message, nil);
        return;
    }
    if ([oldFile isEqualToString:newFile] || [oldFile isEqualToString:patchFile] || [newFile isEqualToString:patchFile]) {
        NSString *message = @"oldFile, newFile, and patchFile should not be the same";
        reject(@"EINVAL", message, nil);
        return;
    }

    NSFileManager *fileManager = [NSFileManager defaultManager];
    if (![fileManager fileExistsAtPath:oldFile]) {
        NSString *message = [NSString stringWithFormat:@"oldFile: %@! does not exist", oldFile];
        reject(@"ENOENT", message, nil);
        return;
    }
    if ([fileManager fileExistsAtPath:newFile]) {
        NSString *message = [NSString stringWithFormat:@"newFile: %@! already exists", newFile];
        reject(@"ENOENT", message, nil);
        return;
    }
    if (![fileManager fileExistsAtPath:patchFile]) {
        NSString *message = [NSString stringWithFormat:@"patchFile: %@! does not exist", newFile];
        reject(@"ENOENT", message, nil);
        return;
    }

    const char *oldFileCString = [oldFile UTF8String];
    const char *newFileCString = [newFile UTF8String];
    const char *patchFileCString = [patchFile UTF8String];

    int result = bsdiffpatch::patchFile(oldFileCString, newFileCString, patchFileCString);
    if (result != 0) {
        NSString *message = [NSString stringWithFormat:@"patch failed with native result %d", result];
        reject(@"EPATCH", message, nil);
        return;
    }
    resolve(@(result));
}

RCT_EXPORT_METHOD(diff:(NSString*) oldFile
                  newFile:(NSString*) newFile
                  patchFile:(NSString*) patchFile
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
    if (oldFile == nil || oldFile.length == 0 || newFile == nil || newFile.length == 0 || patchFile == nil || patchFile.length == 0) {
        NSString *message = @"oldFile, newFile, and patchFile should not be nil or empty";
        reject(@"EINVAL", message, nil);
        return;
    }
    if ([oldFile isEqualToString:newFile] || [oldFile isEqualToString:patchFile] || [newFile isEqualToString:patchFile]) {
        NSString *message = @"oldFile, newFile, and patchFile should not be the same";
        reject(@"EINVAL", message, nil);
        return;
    }

    NSFileManager *fileManager = [NSFileManager defaultManager];
    if (![fileManager fileExistsAtPath:oldFile]) {
        NSString *message = [NSString stringWithFormat:@"oldFile: %@! does not exist", oldFile];
        reject(@"ENOENT", message, nil);
        return;
    }
    if (![fileManager fileExistsAtPath:newFile]) {
        NSString *message = [NSString stringWithFormat:@"newFile: %@! does not exist", newFile];
        reject(@"ENOENT", message, nil);
        return;
    }
    if ([fileManager fileExistsAtPath:patchFile]) {
        NSString *message = [NSString stringWithFormat:@"patchFile: %@! already exists", newFile];
        reject(@"ENOENT", message, nil);
        return;
    }

    const char *oldFileCString = [oldFile UTF8String];
    const char *newFileCString = [newFile UTF8String];
    const char *patchFileCString = [patchFile UTF8String];

    int result = bsdiffpatch::diffFile(oldFileCString, newFileCString, patchFileCString);
    if (result != 0) {
        NSString *message = [NSString stringWithFormat:@"diff failed with native result %d", result];
        reject(@"EDIFF", message, nil);
        return;
    }
    resolve(@(result));
}

#ifdef RCT_NEW_ARCH_ENABLED
- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params
{
    return std::make_shared<facebook::react::NativeBsDiffPatchSpecJSI>(params);
}
#endif

@end
