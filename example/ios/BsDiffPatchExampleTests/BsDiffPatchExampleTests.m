#import <UIKit/UIKit.h>
#import <XCTest/XCTest.h>

#import <React/RCTLog.h>
#import <React/RCTRootView.h>

#define TIMEOUT_SECONDS 120
#define RUNTIME_STATUS_ID @"runtime-status"
#define SUCCESS_STATUS @"Runtime: success"
#define ERROR_STATUS_PREFIX @"Runtime: error:"

@interface BsDiffPatchExampleTests : XCTestCase

@end

@implementation BsDiffPatchExampleTests

- (BOOL)findSubviewInView:(UIView *)view matching:(BOOL (^)(UIView *view))test
{
  if (test(view)) {
    return YES;
  }
  for (UIView *subview in [view subviews]) {
    if ([self findSubviewInView:subview matching:test]) {
      return YES;
    }
  }
  return NO;
}

- (void)testCompletesNativeDiffPatchRoundTrip
{
  UIViewController *vc = [[[RCTSharedApplication() delegate] window] rootViewController];
  NSDate *date = [NSDate dateWithTimeIntervalSinceNow:TIMEOUT_SECONDS];
  __block NSString *runtimeStatus = nil;

  __block NSString *redboxError = nil;
#ifdef DEBUG
  RCTSetLogFunction(
      ^(RCTLogLevel level, RCTLogSource source, NSString *fileName, NSNumber *lineNumber, NSString *message) {
        if (level >= RCTLogLevelError) {
          redboxError = message;
        }
      });
#endif

  while ([date timeIntervalSinceNow] > 0 && !runtimeStatus && !redboxError) {
    [[NSRunLoop mainRunLoop] runMode:NSDefaultRunLoopMode beforeDate:[NSDate dateWithTimeIntervalSinceNow:0.1]];
    [[NSRunLoop mainRunLoop] runMode:NSRunLoopCommonModes beforeDate:[NSDate dateWithTimeIntervalSinceNow:0.1]];

    [self findSubviewInView:vc.view
                   matching:^BOOL(UIView *view) {
                     if ([view.accessibilityIdentifier isEqualToString:RUNTIME_STATUS_ID]) {
                       NSString *status = view.accessibilityLabel;
                       if ([status isEqualToString:SUCCESS_STATUS] ||
                           [status hasPrefix:ERROR_STATUS_PREFIX]) {
                         runtimeStatus = status;
                         return YES;
                       }
                     }
                     return NO;
                   }];
  }

#ifdef DEBUG
  RCTSetLogFunction(RCTDefaultLogFunction);
#endif

  XCTAssertNil(redboxError, @"RedBox error: %@", redboxError);
  XCTAssertEqualObjects(runtimeStatus,
                        SUCCESS_STATUS,
                        @"Expected a successful native diff/patch round trip, got '%@'",
                        runtimeStatus);
}

@end
