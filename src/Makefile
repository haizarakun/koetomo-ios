TARGET := iphone:clang:16.5:14.0
ARCHS := arm64
# 脱獄(rootless)向け .deb と、TrollStore/SideStore 向け未署名 IPA の両方をこの1プロジェクトから作る
THEOS_PACKAGE_SCHEME ?=

include $(THEOS)/makefiles/common.mk

APPLICATION_NAME = KoeTomoPlus

KoeTomoPlus_FILES = $(wildcard Sources/*.m)
KoeTomoPlus_FRAMEWORKS = UIKit WebKit Security Foundation AVFoundation AudioToolbox
KoeTomoPlus_CFLAGS = -fobjc-arc -Wno-deprecated-declarations
KoeTomoPlus_CODESIGN_FLAGS = -SResources/entitlements.plist

include $(THEOS_MAKE_PATH)/application.mk

# 未署名 IPA (Payload/KoeTomoPlus.app) — TrollStore はそのまま、SideStore/AltStore は各自の Apple ID で署名して入れる
ipa: all
	rm -rf $(THEOS_OBJ_DIR)/ipa && mkdir -p $(THEOS_OBJ_DIR)/ipa/Payload
	cp -a $(THEOS_OBJ_DIR)/KoeTomoPlus.app $(THEOS_OBJ_DIR)/ipa/Payload/
	cd $(THEOS_OBJ_DIR)/ipa && rm -f ../KoeTomoPlus.ipa && zip -qr -X ../KoeTomoPlus.ipa Payload
	@ls -l $(THEOS_OBJ_DIR)/KoeTomoPlus.ipa
