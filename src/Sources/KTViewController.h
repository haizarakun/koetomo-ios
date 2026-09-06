#import <UIKit/UIKit.h>
#import <WebKit/WebKit.h>

@interface KTViewController : UIViewController <WKScriptMessageHandler, WKUIDelegate, WKNavigationDelegate>
@property (nonatomic, strong) WKWebView *webView;
- (void)handleIncomingURL:(NSURL *)url;
@end
