#import "KTNotify.h"
#import <UIKit/UIKit.h>
#import <UserNotifications/UserNotifications.h>
#import <BackgroundTasks/BackgroundTasks.h>
#import <Security/Security.h>

static NSString *const kTaskId = @"com.akun.koetomo.refresh";
static NSString *const kPrefEnabled = @"kt_bg_notify";
static NSString *const kPrefLastCount = @"kt_bg_last_count";
static NSString *const kPrefPermission = @"kt_notif_granted";

static NSString *kcToken(void) {
    NSDictionary *q = @{ (__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword, (__bridge id)kSecAttrService: @"com.akun.koetomo", (__bridge id)kSecAttrAccount: @"auth_token", (__bridge id)kSecReturnData: @YES, (__bridge id)kSecMatchLimit: (__bridge id)kSecMatchLimitOne };
    CFTypeRef out = NULL;
    if (SecItemCopyMatching((__bridge CFDictionaryRef)q, &out) != errSecSuccess || !out) return nil;
    return [[NSString alloc] initWithData:(__bridge_transfer NSData *)out encoding:NSUTF8StringEncoding];
}

@implementation KTNotify

+ (void)registerBackgroundTask {
    if (@available(iOS 13.0, *)) {
        [[BGTaskScheduler sharedScheduler] registerForTaskWithIdentifier:kTaskId usingQueue:nil launchHandler:^(BGTask *task) {
            [self scheduleRefresh];
            [self pollOnceWithCompletion:^(BOOL ok) { [task setTaskCompletedWithSuccess:ok]; }];
            __weak BGTask *wt = task;
            task.expirationHandler = ^{ [wt setTaskCompletedWithSuccess:NO]; };
        }];
    }
}

+ (void)scheduleRefresh {
    if (![self enabled]) return;
    if (@available(iOS 13.0, *)) {
        BGAppRefreshTaskRequest *req = [[BGAppRefreshTaskRequest alloc] initWithIdentifier:kTaskId];
        req.earliestBeginDate = [NSDate dateWithTimeIntervalSinceNow:15 * 60];
        NSError *err = nil;
        [[BGTaskScheduler sharedScheduler] submitTaskRequest:req error:&err];
    }
}

+ (void)setEnabled:(BOOL)on {
    [[NSUserDefaults standardUserDefaults] setBool:on forKey:kPrefEnabled];
    if (on) { [self requestPermission]; [self scheduleRefresh]; }
    else if (@available(iOS 13.0, *)) { [[BGTaskScheduler sharedScheduler] cancelTaskRequestWithIdentifier:kTaskId]; }
}
+ (BOOL)enabled { return [[NSUserDefaults standardUserDefaults] boolForKey:kPrefEnabled]; }
+ (BOOL)permissionGrantedCached { return [[NSUserDefaults standardUserDefaults] boolForKey:kPrefPermission]; }

+ (void)requestPermission {
    UNUserNotificationCenter *c = [UNUserNotificationCenter currentNotificationCenter];
    [c requestAuthorizationWithOptions:(UNAuthorizationOptionAlert | UNAuthorizationOptionSound | UNAuthorizationOptionBadge) completionHandler:^(BOOL granted, NSError *error) {
        [[NSUserDefaults standardUserDefaults] setBool:granted forKey:kPrefPermission];
    }];
}

+ (void)showLocal:(NSString *)title body:(NSString *)body {
    UNMutableNotificationContent *content = [UNMutableNotificationContent new];
    content.title = title ?: @"KoeTomo+";
    content.body = body ?: @"";
    content.sound = [UNNotificationSound defaultSound];
    UNNotificationRequest *r = [UNNotificationRequest requestWithIdentifier:[NSUUID UUID].UUIDString content:content trigger:nil];
    [[UNUserNotificationCenter currentNotificationCenter] addNotificationRequest:r withCompletionHandler:nil];
}

// 未読数だけを見る(Android 版 pollOnce と同じ: 増えたときだけ通知)
+ (void)pollOnceWithCompletion:(void (^)(BOOL ok))done {
    NSString *token = kcToken();
    if (!token.length) { done(NO); return; }
    NSString *url = [NSString stringWithFormat:@"https://api.meetscom.com/api/user_notifications/unread_count?version=3.9.101&auth_token=%@", [token stringByAddingPercentEncodingWithAllowedCharacters:[NSCharacterSet URLQueryAllowedCharacterSet]]];
    NSMutableURLRequest *req = [NSMutableURLRequest requestWithURL:[NSURL URLWithString:url]];
    req.timeoutInterval = 20;
    [req setValue:@"okhttp/4.12.0" forHTTPHeaderField:@"User-Agent"];
    [req setValue:@"android_3.9.101" forHTTPHeaderField:@"X-App-Version"];
    [req setValue:token forHTTPHeaderField:@"X-Auth-Token"];
    [[[NSURLSession sharedSession] dataTaskWithRequest:req completionHandler:^(NSData *data, NSURLResponse *resp, NSError *err) {
        NSInteger st = [resp isKindOfClass:[NSHTTPURLResponse class]] ? ((NSHTTPURLResponse *)resp).statusCode : 0;
        if (st != 200 || !data) { done(NO); return; }
        NSDictionary *j = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
        if (![j isKindOfClass:[NSDictionary class]]) { done(NO); return; }
        NSDictionary *src = [j[@"data"] isKindOfClass:[NSDictionary class]] ? j[@"data"] : j;
        id cnt = src[@"unread_count"] ?: (src[@"count"] ?: src[@"unread"]);
        NSInteger n = [cnt respondsToSelector:@selector(integerValue)] ? [cnt integerValue] : 0;
        NSUserDefaults *ud = [NSUserDefaults standardUserDefaults];
        NSInteger last = [ud integerForKey:kPrefLastCount];
        if (n > last && [self enabled]) {
            [self showLocal:@"KoeTomo+" body:[NSString stringWithFormat:@"新着の通知が %ld 件あります", (long)n]];
        }
        [ud setInteger:n forKey:kPrefLastCount];
        dispatch_async(dispatch_get_main_queue(), ^{ [UIApplication sharedApplication].applicationIconBadgeNumber = n; });
        done(YES);
    }] resume];
}

@end
