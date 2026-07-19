cmake_minimum_required(VERSION 3.4.1)
project(BsDiffPatch)

set (CMAKE_VERBOSE_MAKEFILE ON)
set (CMAKE_CXX_STANDARD 11)

file(GLOB BZIP2_SOURCES "../cpp/bzlib/*.c")
set(SOURCES
    ../cpp/bsdiff.c
    ../cpp/bspatch.c
    ../cpp/react-native-bs-diff-patch.cpp
    ${BZIP2_SOURCES}
)

add_library(react-native-bs-diff-patch            SHARED
            ${SOURCES}
            cpp-adapter.cpp
)

# Specifies a path to native header files.
include_directories(
            ../cpp
            ../cpp/bzlib
)
