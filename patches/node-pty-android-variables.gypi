# Подключается node-pty через binding.gyp на Android.
# Пустое значение NDK здесь корректно: Termux собирает против bionic,
# а cpufeatures из NDK не используются.
{
  'variables': {
    'android_ndk_path%': '/nonexistent-android-ndk',
  },
}
