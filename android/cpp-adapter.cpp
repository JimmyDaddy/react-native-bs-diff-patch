#include <jni.h>
#include <android/log.h>

#include <atomic>
#include <cerrno>
#include <chrono>
#include <cstring>
#include <memory>
#include <mutex>
#include <string>
#include <unordered_map>

#include "react-native-bs-diff-patch.h"

namespace {

struct OperationState {
    std::atomic<bool> cancelled{false};
    JNIEnv *env = nullptr;
    jclass nativeClass = nullptr;
    jstring jobId = nullptr;
    int lastPhase = -1;
    std::chrono::steady_clock::time_point lastEmission{};
};

std::mutex operationsMutex;
std::unordered_map<std::string, std::shared_ptr<OperationState>> operations;

std::string javaString(JNIEnv *env, jstring value) {
    const char *characters = env->GetStringUTFChars(value, nullptr);
    if (characters == nullptr) {
        return {};
    }
    std::string result(characters);
    env->ReleaseStringUTFChars(value, characters);
    return result;
}

int isCancelled(void *opaque) {
    auto *state = static_cast<OperationState *>(opaque);
    return state->cancelled.load(std::memory_order_relaxed) ? 1 : 0;
}

void emitProgress(void *opaque, int phase, double progress) {
    auto *state = static_cast<OperationState *>(opaque);
    auto now = std::chrono::steady_clock::now();
    bool phaseChanged = phase != state->lastPhase;
    bool intervalElapsed = state->lastEmission.time_since_epoch().count() == 0 ||
        now - state->lastEmission >= std::chrono::milliseconds(100);

    if (!phaseChanged && !intervalElapsed && progress < 1.0) {
        return;
    }
    if (state->cancelled.load(std::memory_order_relaxed)) {
        return;
    }

    jmethodID callback = state->env->GetStaticMethodID(
        state->nativeClass,
        "onNativeProgress",
        "(Ljava/lang/String;ID)V");
    if (callback == nullptr) {
        state->env->ExceptionClear();
        return;
    }
    state->env->CallStaticVoidMethod(
        state->nativeClass,
        callback,
        state->jobId,
        static_cast<jint>(phase),
        static_cast<jdouble>(progress));
    if (state->env->ExceptionCheck()) {
        state->env->ExceptionClear();
        return;
    }
    state->lastPhase = phase;
    state->lastEmission = now;
}

template <typename Operation>
jint runOperation(
    JNIEnv *env,
    jclass nativeClass,
    jstring jobIdValue,
    jstring oldFileValue,
    jstring newFileValue,
    jstring patchFileValue,
    jlong maxInputBytes,
    jlong maxOutputBytes,
    Operation operation) {
    std::string jobId = javaString(env, jobIdValue);
    std::string oldFile = javaString(env, oldFileValue);
    std::string newFile = javaString(env, newFileValue);
    std::string patchFile = javaString(env, patchFileValue);
    auto state = std::make_shared<OperationState>();
    bs_operation_options options{};

    if (jobId.empty() || oldFile.empty() || newFile.empty() || patchFile.empty()) {
        return BS_OPERATION_ERROR;
    }

    state->env = env;
    state->nativeClass = nativeClass;
    state->jobId = jobIdValue;
    {
        std::lock_guard<std::mutex> lock(operationsMutex);
        if (operations.find(jobId) != operations.end()) {
            return BS_OPERATION_DESTINATION_EXISTS;
        }
        operations.emplace(jobId, state);
    }

    options.max_input_bytes = static_cast<int64_t>(maxInputBytes);
    options.max_output_bytes = static_cast<int64_t>(maxOutputBytes);
    options.opaque = state.get();
    options.is_cancelled = isCancelled;
    options.progress = emitProgress;
    jint result = static_cast<jint>(operation(
        oldFile.c_str(),
        newFile.c_str(),
        patchFile.c_str(),
        &options));

    {
        std::lock_guard<std::mutex> lock(operationsMutex);
        operations.erase(jobId);
    }
    return result;
}

} // namespace

extern "C" JNIEXPORT jint JNICALL
Java_com_jimmydaddy_bsdiffpatch_BsDiffPatchNative_bsDiffFile(
    JNIEnv *env,
    jclass,
    jstring oldFile,
    jstring newFile,
    jstring patchFile) {
    jint result = static_cast<jint>(bsdiffpatch::diffFile(
        javaString(env, oldFile).c_str(),
        javaString(env, newFile).c_str(),
        javaString(env, patchFile).c_str()));
    if (result != BS_OPERATION_OK) {
        const char *stage = bsdiffpatch::diffLastErrorStage();
        __android_log_print(
            ANDROID_LOG_ERROR,
            "BsDiffPatch",
            "diff failed at %s: result=%d errno=%d (%s)",
            stage == nullptr ? "unknown" : stage,
            result,
            errno,
            std::strerror(errno));
    }
    return result;
}

extern "C" JNIEXPORT jint JNICALL
Java_com_jimmydaddy_bsdiffpatch_BsDiffPatchNative_bsPatchFile(
    JNIEnv *env,
    jclass,
    jstring oldFile,
    jstring newFile,
    jstring patchFile) {
    return static_cast<jint>(bsdiffpatch::patchFile(
        javaString(env, oldFile).c_str(),
        javaString(env, newFile).c_str(),
        javaString(env, patchFile).c_str()));
}

extern "C" JNIEXPORT jint JNICALL
Java_com_jimmydaddy_bsdiffpatch_BsDiffPatchNative_bsDiffFileWithOptions(
    JNIEnv *env,
    jclass nativeClass,
    jstring jobId,
    jstring oldFile,
    jstring newFile,
    jstring patchFile,
    jlong maxInputBytes,
    jlong maxOutputBytes) {
    return runOperation(
        env,
        nativeClass,
        jobId,
        oldFile,
        newFile,
        patchFile,
        maxInputBytes,
        maxOutputBytes,
        bsdiffpatch::diffFileWithOptions);
}

extern "C" JNIEXPORT jint JNICALL
Java_com_jimmydaddy_bsdiffpatch_BsDiffPatchNative_bsPatchFileWithOptions(
    JNIEnv *env,
    jclass nativeClass,
    jstring jobId,
    jstring oldFile,
    jstring newFile,
    jstring patchFile,
    jlong maxInputBytes,
    jlong maxOutputBytes) {
    return runOperation(
        env,
        nativeClass,
        jobId,
        oldFile,
        newFile,
        patchFile,
        maxInputBytes,
        maxOutputBytes,
        bsdiffpatch::patchFileWithOptions);
}

extern "C" JNIEXPORT jboolean JNICALL
Java_com_jimmydaddy_bsdiffpatch_BsDiffPatchNative_bsCancelOperation(
    JNIEnv *env,
    jclass,
    jstring jobIdValue) {
    std::string jobId = javaString(env, jobIdValue);
    std::lock_guard<std::mutex> lock(operationsMutex);
    auto operation = operations.find(jobId);
    if (operation == operations.end()) {
        return JNI_FALSE;
    }
    operation->second->cancelled.store(true, std::memory_order_relaxed);
    return JNI_TRUE;
}
