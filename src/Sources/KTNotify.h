#import <Foundation/Foundation.h>
// バックグラウンド通知(Android の KoeNotifyService 相当): BGAppRefreshTask で未読通知数を取りに行き、増えていればローカル通知を出す
@interface KTNotify : NSObject
+ (void)registerBackgroundTask;          // didFinishLaunching で1回
+ (void)scheduleRefresh;                 // バックグラウンドに入るたび
+ (void)setEnabled:(BOOL)on;             // 設定画面のトグル(KoeApp.setBackgroundNotify)
+ (BOOL)enabled;
+ (void)requestPermission;
+ (BOOL)permissionGrantedCached;
+ (void)showLocal:(NSString *)title body:(NSString *)body;
+ (void)pollOnceWithCompletion:(void (^)(BOOL ok))done; // 前面でも使う
@end
