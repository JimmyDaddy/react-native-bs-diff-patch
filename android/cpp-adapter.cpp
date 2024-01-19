#include <jni.h>
#include "react-native-bs-diff-patch.h"

extern "C"
JNIEXPORT jdouble JNICALL
Java_com_bsdiffpatch_BsDiffPatchModule_nativeMultiply(JNIEnv *env, jclass type, jdouble a, jdouble b) {
    return bsdiffpatch::multiply(a, b);
}
