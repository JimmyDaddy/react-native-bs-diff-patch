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

dispatch_semaphore_t operationSemaphore()
{
    static dispatch_semaphore_t semaphore;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        semaphore = dispatch_semaphore_create(1);
    });
    return semaphore;
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
            DISPATCH_QUEUE_CONCURRENT);
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

    dispatch_semaphore_wait(operationSemaphore(), DISPATCH_TIME_FOREVER);
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
    dispatch_semaphore_signal(operationSemaphore());
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

    dispatch_semaphore_wait(operationSemaphore(), DISPATCH_TIME_FOREVER);
    int result = bsdiffpatch::patchFile(
        [oldFile UTF8String], [newFile UTF8String], [patchFile UTF8String]);
    dispatch_semaphore_signal(operationSemaphore());
    if (result == 0) resolve(@(result));
    else reject(@"EPATCH", [NSString stringWithFormat:@"patch failed with native result %d", result], nil);
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

    dispatch_semaphore_wait(operationSemaphore(), DISPATCH_TIME_FOREVER);
    int result = bsdiffpatch::diffFile(
        [oldFile UTF8String], [newFile UTF8String], [patchFile UTF8String]);
    dispatch_semaphore_signal(operationSemaphore());
    if (result == 0) resolve(@(result));
    else reject(@"EDIFF", [NSString stringWithFormat:@"diff failed with native result %d", result], nil);
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
