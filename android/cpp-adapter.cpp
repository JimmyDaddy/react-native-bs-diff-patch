#include <jni.h>
#include "react-native-bs-diff-patch.h"

extern "C"

JNIEXPORT jint JNICALL
Java_com_jimmydaddy_bsdiffpatch_BsDiffPatchModule_00024Companion_bsDiffFile(JNIEnv *env,
                                                                            jobject type, jstring oldFile_,
                                                  jstring newFile_, jstring patchFile_) {
    const char *oldFile = env->GetStringUTFChars(oldFile_, 0);
    const char *newFile = env->GetStringUTFChars(newFile_, 0);
    const char *patchFile = env->GetStringUTFChars(patchFile_, 0);

    int result = bsdiffpatch::diffFile(oldFile, newFile, patchFile);

    env->ReleaseStringUTFChars(oldFile_, oldFile);
    env->ReleaseStringUTFChars(newFile_, newFile);
    env->ReleaseStringUTFChars(patchFile_, patchFile);

    return result;
}

extern "C" JNIEXPORT jint JNICALL
Java_com_jimmydaddy_bsdiffpatch_BsDiffPatchModule_00024Companion_bsPatchFile(JNIEnv *env,
                                                                             jobject type, jstring oldFile_,
                                                   jstring newFile_, jstring patchFile_) {
    const char *oldFile = env->GetStringUTFChars(oldFile_, 0);
    const char *newFile = env->GetStringUTFChars(newFile_, 0);
    const char *patchFile = env->GetStringUTFChars(patchFile_, 0);

    int result = bsdiffpatch::patchFile(oldFile, newFile, patchFile);

    env->ReleaseStringUTFChars(oldFile_, oldFile);
    env->ReleaseStringUTFChars(newFile_, newFile);
    env->ReleaseStringUTFChars(patchFile_, patchFile);

    return result;
}
