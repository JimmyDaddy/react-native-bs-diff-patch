#import "BsDiffPatch.h"

#import <atomic>
#import <chrono>
#import <cmath>
#import <memory>
#import <mutex>
#import <string>
#import <unordered_map>

#ifdef RCT_NEW_ARCH_ENABLED
#import <ReactCommon/RCTTurboModule.h>
#endif

static NSString *const BsDiffPatchProgressEvent = @"BsDiffPatchProgress";

@class BsDiffPatch;

namespace {

struct OperationState {
    std::atomic<bool> cancelled{false};
    __strong BsDiffPatch *module = nil;
    __strong NSString *jobId = nil;
    int lastPhase = -1;
    std::chrono::steady_clock::time_point lastEmission{};
};

std::mutex operationsMutex;
std::unordered_map<std::string, std::shared_ptr<OperationState>> operations;

dispatch_queue_t operationQueue()
{
    static dispatch_queue_t queue;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        queue = dispatch_queue_create(
            "com.jimmydaddy.bsdiffpatch.worker",
            DISPATCH_QUEUE_SERIAL);
    });
    return queue;
}

std::string operationKey(NSString *jobId)
{
    return std::string([jobId UTF8String] ?: "");
}

int isCancelled(void *opaque)
{
    auto *state = static_cast<OperationState *>(opaque);
    return state->cancelled.load(std::memory_order_relaxed) ? 1 : 0;
}

} // namespace

@interface BsDiffPatch ()

@property(nonatomic, assign) BOOL hasProgressListeners;

- (void)emitProgressForState:(OperationState *)state
                       phase:(int)phase
                    progress:(double)progress;

@end

namespace {

void emitProgress(void *opaque, int phase, double progress)
{
    auto *state = static_cast<OperationState *>(opaque);
    auto now = std::chrono::steady_clock::now();
    bool phaseChanged = phase != state->lastPhase;
    bool intervalElapsed = state->lastEmission.time_since_epoch().count() == 0 ||
        now - state->lastEmission >= std::chrono::milliseconds(100);

    if ((!phaseChanged && !intervalElapsed && progress < 1.0) ||
        state->cancelled.load(std::memory_order_relaxed)) {
        return;
    }
    [state->module emitProgressForState:state phase:phase progress:progress];
    state->lastPhase = phase;
    state->lastEmission = now;
}

std::shared_ptr<OperationState> registerOperation(BsDiffPatch *module, NSString *jobId)
{
    std::string key = operationKey(jobId);
    auto state = std::make_shared<OperationState>();
    state->module = module;
    state->jobId = jobId;
    std::lock_guard<std::mutex> lock(operationsMutex);
    if (key.empty() || operations.find(key) != operations.end()) {
        return nullptr;
    }
    operations.emplace(key, state);
    return state;
}

void removeOperation(NSString *jobId)
{
    std::lock_guard<std::mutex> lock(operationsMutex);
    operations.erase(operationKey(jobId));
}

bool cancelOperation(NSString *jobId)
{
    std::lock_guard<std::mutex> lock(operationsMutex);
    auto operation = operations.find(operationKey(jobId));
    if (operation == operations.end()) {
        return false;
    }
    operation->second->cancelled.store(true, std::memory_order_relaxed);
    return true;
}

void cancelAllOperations()
{
    std::lock_guard<std::mutex> lock(operationsMutex);
    for (const auto &operation : operations) {
        operation.second->cancelled.store(true, std::memory_order_relaxed);
    }
}

} // namespace

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
        queue = dispatch_queue_create(
            "com.jimmydaddy.bsdiffpatch.module",
            DISPATCH_QUEUE_SERIAL);
    });
    return queue;
}

- (NSArray<NSString *> *)supportedEvents
{
    return @[ BsDiffPatchProgressEvent ];
}

- (void)startObserving
{
    self.hasProgressListeners = YES;
}

- (void)stopObserving
{
    self.hasProgressListeners = NO;
}

- (void)invalidate
{
    cancelAllOperations();
    [super invalidate];
}

- (NSString *)normalizedPath:(NSString *)path
{
    return [path hasPrefix:@"file://"] ? [path substringFromIndex:7] : path;
}

- (NSDictionary *)patchMetadataAtPath:(NSString *)patchFile
                                error:(NSError **)error
{
    NSFileManager *fileManager = [NSFileManager defaultManager];
    NSDictionary *attributes = [fileManager attributesOfItemAtPath:patchFile error:error];
    if (attributes == nil) return nil;

    unsigned long long patchBytes = [attributes fileSize];
    NSFileHandle *handle = [NSFileHandle fileHandleForReadingAtPath:patchFile];
    if (handle == nil) {
        if (error != nullptr) {
            *error = [NSError errorWithDomain:@"BsDiffPatch"
                                         code:1
                                     userInfo:@{NSLocalizedDescriptionKey : @"could not read patchFile"}];
        }
        return nil;
    }
    NSData *header = [handle readDataOfLength:24];
    [handle closeFile];
    const uint8_t *bytes = static_cast<const uint8_t *>(header.bytes);
    NSUInteger headerBytes = header.length;
    NSString *legacyMagic = [[NSString alloc]
        initWithBytes:bytes
               length:MIN((NSUInteger)8, headerBytes)
             encoding:NSASCIIStringEncoding] ?: @"";
    NSString *currentMagic = [[NSString alloc]
        initWithBytes:bytes
               length:MIN((NSUInteger)16, headerBytes)
             encoding:NSASCIIStringEncoding] ?: @"";

    NSString *format = @"UNKNOWN";
    NSString *issue = nil;
    NSString *declaredTargetBytes = nil;
    BOOL valid = NO;
    if (headerBytes < 24) {
        if ([legacyMagic isEqualToString:@"BSDIFF40"]) {
            format = @"BSDIFF40";
            issue = @"LEGACY_FORMAT";
        } else {
            issue = @"TRUNCATED_HEADER";
        }
    } else if (![currentMagic isEqualToString:@"ENDSLEY/BSDIFF43"]) {
        if ([legacyMagic isEqualToString:@"BSDIFF40"]) {
            format = @"BSDIFF40";
            issue = @"LEGACY_FORMAT";
        } else {
            issue = @"INVALID_MAGIC";
        }
    } else if ((bytes[23] & 0x80) != 0) {
        format = @"ENDSLEY/BSDIFF43";
        issue = @"INVALID_TARGET_SIZE";
    } else {
        unsigned long long targetBytes = 0;
        for (NSInteger index = 23; index >= 16; index--) {
            targetBytes = targetBytes * 256 + bytes[index];
        }
        format = @"ENDSLEY/BSDIFF43";
        declaredTargetBytes = [NSString stringWithFormat:@"%llu", targetBytes];
        valid = YES;
    }

    NSMutableDictionary *metadata = [@{
        @"format" : format,
        @"patchBytes" : @(patchBytes),
        @"headerBytes" : @(headerBytes),
        @"payloadBytes" : @(patchBytes > 24 ? patchBytes - 24 : 0),
        @"declaredTargetBytes" : declaredTargetBytes ?: [NSNull null],
        @"valid" : @(valid)
    } mutableCopy];
    if (issue != nil) metadata[@"issue"] = issue;
    return metadata;
}

- (NSString *)JSONStringForObject:(id)object error:(NSError **)error
{
    NSData *data = [NSJSONSerialization dataWithJSONObject:object options:0 error:error];
    if (data == nil) return nil;
    return [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
}

- (BOOL)fileAtPath:(NSString *)firstPath equalsFileAtPath:(NSString *)secondPath
{
    NSDictionary *firstAttributes = [[NSFileManager defaultManager]
        attributesOfItemAtPath:firstPath
                         error:nil];
    NSDictionary *secondAttributes = [[NSFileManager defaultManager]
        attributesOfItemAtPath:secondPath
                         error:nil];
    if (firstAttributes == nil || secondAttributes == nil ||
        [firstAttributes fileSize] != [secondAttributes fileSize]) {
        return NO;
    }

    NSFileHandle *first = [NSFileHandle fileHandleForReadingAtPath:firstPath];
    NSFileHandle *second = [NSFileHandle fileHandleForReadingAtPath:secondPath];
    if (first == nil || second == nil) {
        [first closeFile];
        [second closeFile];
        return NO;
    }
    BOOL equal = YES;
    while (YES) {
        @autoreleasepool {
            NSData *firstChunk = [first readDataOfLength:64 * 1024];
            NSData *secondChunk = [second readDataOfLength:64 * 1024];
            if (![firstChunk isEqualToData:secondChunk]) {
                equal = NO;
                break;
            }
            if (firstChunk.length == 0) break;
        }
    }
    [first closeFile];
    [second closeFile];
    return equal;
}

- (BOOL)validateOldFile:(NSString *)oldFile
                newFile:(NSString *)newFile
               patchFile:(NSString *)patchFile
                  reject:(RCTPromiseRejectBlock)reject
{
    if (oldFile == nil || oldFile.length == 0 ||
        newFile == nil || newFile.length == 0 ||
        patchFile == nil || patchFile.length == 0) {
        reject(@"EINVAL", @"oldFile, newFile, and patchFile should not be nil or empty", nil);
        return NO;
    }
    if ([oldFile isEqualToString:newFile] ||
        [oldFile isEqualToString:patchFile] ||
        [newFile isEqualToString:patchFile]) {
        reject(@"EINVAL", @"oldFile, newFile, and patchFile should not be the same", nil);
        return NO;
    }
    return YES;
}

- (BOOL)validateLimit:(double)value
                  name:(NSString *)name
                reject:(RCTPromiseRejectBlock)reject
{
    if (value == 0) {
        return YES;
    }
    if (!std::isfinite(value) || value < 1 || value > 9007199254740991.0 ||
        std::floor(value) != value) {
        reject(
            @"EINVAL",
            [NSString stringWithFormat:@"%@ must be a positive safe integer", name],
            nil);
        return NO;
    }
    return YES;
}

- (BOOL)validateFilesForOperation:(NSString *)operation
                          oldFile:(NSString *)oldFile
                          newFile:(NSString *)newFile
                         patchFile:(NSString *)patchFile
                            reject:(RCTPromiseRejectBlock)reject
{
    NSFileManager *fileManager = [NSFileManager defaultManager];
    BOOL patch = [operation isEqualToString:@"patch"];
    NSString *secondInput = patch ? patchFile : newFile;
    NSString *output = patch ? newFile : patchFile;
    NSString *secondInputName = patch ? @"patchFile" : @"newFile";
    NSString *outputName = patch ? @"newFile" : @"patchFile";

    if (![fileManager fileExistsAtPath:oldFile]) {
        reject(@"ENOENT", [NSString stringWithFormat:@"oldFile: %@ does not exist", oldFile], nil);
        return NO;
    }
    if (![fileManager fileExistsAtPath:secondInput]) {
        reject(
            @"ENOENT",
            [NSString stringWithFormat:@"%@: %@ does not exist", secondInputName, secondInput],
            nil);
        return NO;
    }
    if ([fileManager fileExistsAtPath:output]) {
        reject(
            @"EEXIST",
            [NSString stringWithFormat:@"%@: %@ already exists", outputName, output],
            nil);
        return NO;
    }
    return YES;
}

- (void)rejectOperation:(NSString *)operation
                  result:(int)result
           maxInputBytes:(int64_t)maxInputBytes
          maxOutputBytes:(int64_t)maxOutputBytes
                  reject:(RCTPromiseRejectBlock)reject
{
    NSString *code;
    NSString *detail;
    switch (result) {
        case BS_OPERATION_INPUT_TOO_LARGE:
            code = @"EINPUT_TOO_LARGE";
            detail = [NSString stringWithFormat:
                @"configured input limit: %lld bytes", (long long)maxInputBytes];
            break;
        case BS_OPERATION_OUTPUT_TOO_LARGE:
            code = @"EOUTPUT_TOO_LARGE";
            detail = [NSString stringWithFormat:
                @"configured output limit: %lld bytes", (long long)maxOutputBytes];
            break;
        case BS_OPERATION_CANCELLED:
            code = @"ECANCELLED";
            detail = @"operation was cancelled";
            break;
        case BS_OPERATION_DESTINATION_EXISTS:
            code = @"EEXIST";
            detail = @"destination or job already exists";
            break;
        default:
            code = [operation isEqualToString:@"patch"] ? @"EPATCH" : @"EDIFF";
            detail = [NSString stringWithFormat:@"native result %d", result];
            break;
    }
    reject(code, [NSString stringWithFormat:@"%@ failed: %@", operation, detail], nil);
}

- (void)runJob:(NSString *)operation
          jobId:(NSString *)jobId
        oldFile:(NSString *)oldFile
        newFile:(NSString *)newFile
       patchFile:(NSString *)patchFile
  maxInputBytes:(double)maxInputBytes
 maxOutputBytes:(double)maxOutputBytes
        resolve:(RCTPromiseResolveBlock)resolve
         reject:(RCTPromiseRejectBlock)reject
{
    if (jobId == nil || jobId.length == 0) {
        reject(@"EINVAL", @"jobId should not be nil or empty", nil);
        return;
    }
    if (![self validateOldFile:oldFile newFile:newFile patchFile:patchFile reject:reject] ||
        ![self validateLimit:maxInputBytes name:@"maxInputBytes" reject:reject] ||
        ![self validateLimit:maxOutputBytes name:@"maxOutputBytes" reject:reject]) {
        return;
    }

    oldFile = [self normalizedPath:oldFile];
    newFile = [self normalizedPath:newFile];
    patchFile = [self normalizedPath:patchFile];
    if (![self validateFilesForOperation:operation
                                 oldFile:oldFile
                                 newFile:newFile
                                patchFile:patchFile
                                   reject:reject]) {
        return;
    }

    auto state = registerOperation(self, jobId);
    if (state == nullptr) {
        reject(@"EEXIST", [NSString stringWithFormat:@"jobId: %@ already exists", jobId], nil);
        return;
    }

    dispatch_async(operationQueue(), ^{
        int result;
        if (state->cancelled.load(std::memory_order_relaxed)) {
            result = BS_OPERATION_CANCELLED;
        } else {
            bs_operation_options options{};
            options.max_input_bytes = (int64_t)maxInputBytes;
            options.max_output_bytes = (int64_t)maxOutputBytes;
            options.opaque = state.get();
            options.is_cancelled = isCancelled;
            options.progress = emitProgress;
            result = [operation isEqualToString:@"patch"]
                ? bsdiffpatch::patchFileWithOptions(
                      [oldFile UTF8String],
                      [newFile UTF8String],
                      [patchFile UTF8String],
                      &options)
                : bsdiffpatch::diffFileWithOptions(
                      [oldFile UTF8String],
                      [newFile UTF8String],
                      [patchFile UTF8String],
                      &options);
        }
        removeOperation(jobId);

        if (result == BS_OPERATION_OK) {
            resolve(@(result));
        } else {
            [self rejectOperation:operation
                           result:result
                    maxInputBytes:(int64_t)maxInputBytes
                   maxOutputBytes:(int64_t)maxOutputBytes
                           reject:reject];
        }
    });
}

RCT_EXPORT_METHOD(patch:(NSString *)oldFile
                  newFile:(NSString *)newFile
                  patchFile:(NSString *)patchFile
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
    if (![self validateOldFile:oldFile newFile:newFile patchFile:patchFile reject:reject]) return;
    oldFile = [self normalizedPath:oldFile];
    newFile = [self normalizedPath:newFile];
    patchFile = [self normalizedPath:patchFile];
    if (![self validateFilesForOperation:@"patch"
                                 oldFile:oldFile
                                 newFile:newFile
                                patchFile:patchFile
                                   reject:reject]) return;

    dispatch_async(operationQueue(), ^{
        int result = bsdiffpatch::patchFile(
            [oldFile UTF8String], [newFile UTF8String], [patchFile UTF8String]);
        if (result == 0) resolve(@(result));
        else reject(@"EPATCH", [NSString stringWithFormat:@"patch failed with native result %d", result], nil);
    });
}

RCT_EXPORT_METHOD(diff:(NSString *)oldFile
                  newFile:(NSString *)newFile
                  patchFile:(NSString *)patchFile
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
    if (![self validateOldFile:oldFile newFile:newFile patchFile:patchFile reject:reject]) return;
    oldFile = [self normalizedPath:oldFile];
    newFile = [self normalizedPath:newFile];
    patchFile = [self normalizedPath:patchFile];
    if (![self validateFilesForOperation:@"diff"
                                 oldFile:oldFile
                                 newFile:newFile
                                patchFile:patchFile
                                   reject:reject]) return;

    dispatch_async(operationQueue(), ^{
        int result = bsdiffpatch::diffFile(
            [oldFile UTF8String], [newFile UTF8String], [patchFile UTF8String]);
        if (result == 0) resolve(@(result));
        else reject(@"EDIFF", [NSString stringWithFormat:@"diff failed with native result %d", result], nil);
    });
}

RCT_EXPORT_METHOD(inspectPatch:(NSString *)patchFile
                  maxInputBytes:(double)maxInputBytes
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
    if (patchFile == nil || patchFile.length == 0) {
        reject(@"EINVAL", @"patchFile should not be nil or empty", nil);
        return;
    }
    if (![self validateLimit:maxInputBytes name:@"maxInputBytes" reject:reject]) return;
    patchFile = [self normalizedPath:patchFile];
    if (![[NSFileManager defaultManager] fileExistsAtPath:patchFile]) {
        reject(@"ENOENT", [NSString stringWithFormat:@"patchFile: %@ does not exist", patchFile], nil);
        return;
    }

    dispatch_async(operationQueue(), ^{
        NSError *error = nil;
        NSDictionary *attributes = [[NSFileManager defaultManager]
            attributesOfItemAtPath:patchFile
                             error:&error];
        if (attributes == nil) {
            reject(@"ENOENT", error.localizedDescription ?: @"could not inspect patchFile", error);
            return;
        }
        if (maxInputBytes > 0 && [attributes fileSize] > (unsigned long long)maxInputBytes) {
            reject(
                @"ERESOURCE",
                [NSString stringWithFormat:
                    @"patchData is %llu bytes and exceeds the configured %.0f byte limit",
                    [attributes fileSize],
                    maxInputBytes],
                nil);
            return;
        }
        NSDictionary *metadata = [self patchMetadataAtPath:patchFile error:&error];
        NSString *json = metadata == nil
            ? nil
            : [self JSONStringForObject:metadata error:&error];
        if (json == nil) {
            reject(@"EUNSPECIFIED", error.localizedDescription ?: @"could not encode patch metadata", error);
            return;
        }
        resolve(json);
    });
}

RCT_EXPORT_METHOD(verifyPatch:(NSString *)oldFile
                  patchFile:(NSString *)patchFile
                  expectedFile:(NSString *)expectedFile
                  maxInputBytes:(double)maxInputBytes
                  maxOutputBytes:(double)maxOutputBytes
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
    if (oldFile == nil || oldFile.length == 0 ||
        patchFile == nil || patchFile.length == 0 ||
        expectedFile == nil || expectedFile.length == 0) {
        reject(@"EINVAL", @"oldFile, patchFile, and expectedFile should not be nil or empty", nil);
        return;
    }
    if (![self validateLimit:maxInputBytes name:@"maxInputBytes" reject:reject] ||
        ![self validateLimit:maxOutputBytes name:@"maxOutputBytes" reject:reject]) {
        return;
    }
    oldFile = [self normalizedPath:oldFile];
    patchFile = [self normalizedPath:patchFile];
    expectedFile = [self normalizedPath:expectedFile];
    if ([oldFile isEqualToString:patchFile] ||
        [oldFile isEqualToString:expectedFile] ||
        [patchFile isEqualToString:expectedFile]) {
        reject(@"EINVAL", @"oldFile, patchFile, and expectedFile should not be the same", nil);
        return;
    }
    NSFileManager *fileManager = [NSFileManager defaultManager];
    for (NSString *path in @[ oldFile, patchFile, expectedFile ]) {
        if (![fileManager fileExistsAtPath:path]) {
            reject(@"ENOENT", [NSString stringWithFormat:@"input: %@ does not exist", path], nil);
            return;
        }
    }

    dispatch_async(operationQueue(), ^{
        NSError *error = nil;
        NSDictionary *oldAttributes = [fileManager attributesOfItemAtPath:oldFile error:&error];
        NSDictionary *patchAttributes = [fileManager attributesOfItemAtPath:patchFile error:&error];
        NSDictionary *expectedAttributes = [fileManager attributesOfItemAtPath:expectedFile error:&error];
        if (oldAttributes == nil || patchAttributes == nil || expectedAttributes == nil) {
            reject(@"ENOENT", error.localizedDescription ?: @"could not read input metadata", error);
            return;
        }
        if (maxInputBytes > 0 &&
            ([oldAttributes fileSize] > (unsigned long long)maxInputBytes ||
             [patchAttributes fileSize] > (unsigned long long)maxInputBytes ||
             [expectedAttributes fileSize] > (unsigned long long)maxInputBytes)) {
            reject(@"ERESOURCE", @"verification input exceeds maxInputBytes", nil);
            return;
        }

        NSDictionary *metadata = [self patchMetadataAtPath:patchFile error:&error];
        if (metadata == nil) {
            reject(@"EPATCH", error.localizedDescription ?: @"could not inspect patchFile", error);
            return;
        }
        if (![metadata[@"valid"] boolValue]) {
            reject(
                @"EPATCH",
                [NSString stringWithFormat:
                    @"patch structure is invalid: %@",
                    metadata[@"issue"] ?: @"UNKNOWN"],
                nil);
            return;
        }
        unsigned long long declaredTargetBytes =
            [metadata[@"declaredTargetBytes"] longLongValue];
        if (maxOutputBytes > 0 && declaredTargetBytes > (unsigned long long)maxOutputBytes) {
            reject(@"ERESOURCE", @"declared output exceeds maxOutputBytes", nil);
            return;
        }

        NSString *outputFile = [NSTemporaryDirectory()
            stringByAppendingPathComponent:[NSString stringWithFormat:
                @"bsdiffpatch-verify-%@.tmp",
                [NSUUID UUID].UUIDString]];
        int result = bsdiffpatch::patchFile(
            [oldFile UTF8String], [outputFile UTF8String], [patchFile UTF8String]);
        if (result != 0) {
            [fileManager removeItemAtPath:outputFile error:nil];
            reject(@"EPATCH", [NSString stringWithFormat:@"patch verification failed with native result %d", result], nil);
            return;
        }

        NSDictionary *outputAttributes = [fileManager attributesOfItemAtPath:outputFile error:&error];
        if (outputAttributes == nil) {
            [fileManager removeItemAtPath:outputFile error:nil];
            reject(@"EPATCH", error.localizedDescription ?: @"could not read restored output", error);
            return;
        }
        if (maxOutputBytes > 0 && [outputAttributes fileSize] > (unsigned long long)maxOutputBytes) {
            [fileManager removeItemAtPath:outputFile error:nil];
            reject(@"ERESOURCE", @"restored output exceeds maxOutputBytes", nil);
            return;
        }
        BOOL verified = [self fileAtPath:outputFile equalsFileAtPath:expectedFile];
        NSDictionary *verification = @{
            @"verified" : @(verified),
            @"restoredBytes" : @([outputAttributes fileSize]),
            @"expectedBytes" : @([expectedAttributes fileSize]),
            @"patch" : metadata
        };
        NSString *json = [self JSONStringForObject:verification error:&error];
        [fileManager removeItemAtPath:outputFile error:nil];
        if (json == nil) {
            reject(@"EUNSPECIFIED", error.localizedDescription ?: @"could not encode verification result", error);
            return;
        }
        resolve(json);
    });
}

RCT_EXPORT_METHOD(startPatch:(NSString *)jobId
                  oldFile:(NSString *)oldFile
                  newFile:(NSString *)newFile
                  patchFile:(NSString *)patchFile
                  maxInputBytes:(double)maxInputBytes
                  maxOutputBytes:(double)maxOutputBytes
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
    [self runJob:@"patch"
           jobId:jobId
         oldFile:oldFile
         newFile:newFile
        patchFile:patchFile
   maxInputBytes:maxInputBytes
  maxOutputBytes:maxOutputBytes
         resolve:resolve
          reject:reject];
}

RCT_EXPORT_METHOD(startDiff:(NSString *)jobId
                  oldFile:(NSString *)oldFile
                  newFile:(NSString *)newFile
                  patchFile:(NSString *)patchFile
                  maxInputBytes:(double)maxInputBytes
                  maxOutputBytes:(double)maxOutputBytes
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
    [self runJob:@"diff"
           jobId:jobId
         oldFile:oldFile
         newFile:newFile
        patchFile:patchFile
   maxInputBytes:maxInputBytes
  maxOutputBytes:maxOutputBytes
         resolve:resolve
          reject:reject];
}

RCT_EXPORT_METHOD(cancel:(NSString *)jobId
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
    if (jobId == nil || jobId.length == 0) {
        reject(@"EINVAL", @"jobId should not be nil or empty", nil);
        return;
    }
    resolve(@(cancelOperation(jobId)));
}

- (void)emitProgressForState:(OperationState *)state
                       phase:(int)phase
                    progress:(double)progress
{
    if (!self.hasProgressListeners) return;
    NSString *phaseName = phase == BS_OPERATION_READING
        ? @"reading"
        : (phase == BS_OPERATION_PROCESSING ? @"processing" : @"writing");
    [self sendEventWithName:BsDiffPatchProgressEvent
                       body:@{
                           @"id" : state->jobId,
                           @"phase" : phaseName,
                           @"progress" : @(MAX(0.0, MIN(1.0, progress)))
                       }];
}

#ifdef RCT_NEW_ARCH_ENABLED
- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params
{
    return std::make_shared<facebook::react::NativeBsDiffPatchSpecJSI>(params);
}
#endif

@end
