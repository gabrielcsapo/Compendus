#import <Foundation/Foundation.h>

NSBundle* whisper_SWIFTPM_MODULE_BUNDLE() {
    NSURL *bundleURL = [[[NSBundle mainBundle] bundleURL] URLByAppendingPathComponent:@"whisper_whisper.bundle"];

    NSBundle *preferredBundle = [NSBundle bundleWithURL:bundleURL];
    if (preferredBundle == nil) {
      return [NSBundle bundleWithPath:@"/Users/gabrielcsapo/Documents/coding/Compendus/Compendus/Packages/whisper.cpp/.build/index-build/arm64-apple-macosx/debug/whisper_whisper.bundle"];
    }

    return preferredBundle;
}