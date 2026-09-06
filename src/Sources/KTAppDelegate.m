#import "KTAppDelegate.h"
#import "KTViewController.h"
#import <AVFoundation/AVFoundation.h>

@implementation KTAppDelegate

- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)launchOptions {
    // 通話(WebRTC)用: 再生+録音カテゴリ。バックグラウンドでも音声が続くように audio モードを使う
    NSError *err = nil;
    [[AVAudioSession sharedInstance] setCategory:AVAudioSessionCategoryPlayAndRecord
                                     withOptions:AVAudioSessionCategoryOptionDefaultToSpeaker | AVAudioSessionCategoryOptionAllowBluetooth | AVAudioSessionCategoryOptionMixWithOthers
                                           error:&err];
    self.window = [[UIWindow alloc] initWithFrame:[UIScreen mainScreen].bounds];
    self.window.backgroundColor = [UIColor colorWithRed:0.07 green:0.08 blue:0.10 alpha:1];
    self.window.rootViewController = [[KTViewController alloc] init];
    [self.window makeKeyAndVisible];
    return YES;
}

- (BOOL)application:(UIApplication *)app openURL:(NSURL *)url options:(NSDictionary<UIApplicationOpenURLOptionsKey,id> *)options {
    KTViewController *vc = (KTViewController *)self.window.rootViewController;
    if ([vc respondsToSelector:@selector(handleIncomingURL:)]) [vc handleIncomingURL:url];
    return YES;
}

@end
