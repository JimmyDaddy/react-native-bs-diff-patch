/*-
 * Copyright 2003-2005 Colin Percival
 * Copyright 2012 Matthew Endsley
 * All rights reserved
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted providing that the following conditions
 * are met:
 * 1. Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY THE AUTHOR ``AS IS'' AND ANY EXPRESS OR
 * IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
 * ARE DISCLAIMED.  IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY
 * DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
 * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS
 * OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION)
 * HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT,
 * STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING
 * IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
 * POSSIBILITY OF SUCH DAMAGE.
 */

#if defined(__linux__) && !defined(_GNU_SOURCE)
#define _GNU_SOURCE
#endif

#include <limits.h>
#include "bspatch.h"
#include "bsdiffpatch_operation.h"

#include <errno.h>

#if defined(__APPLE__)
#include <sys/stdio.h>
#elif defined(__linux__)
#include <linux/fs.h>
#include <sys/syscall.h>
#endif

#define BSPATCH_IO_CHUNK (64 * 1024)

static int bspatch_cancelled(const struct bspatch_stream *stream)
{
	return stream->is_cancelled != NULL && stream->is_cancelled(stream);
}

static void bspatch_progress(const struct bspatch_stream *stream, double progress)
{
	if (stream->progress != NULL)
		stream->progress(stream, progress);
}

static int64_t offtin(uint8_t *buf)
{
	int64_t y;

	y=buf[7]&0x7F;
	y=y*256;y+=buf[6];
	y=y*256;y+=buf[5];
	y=y*256;y+=buf[4];
	y=y*256;y+=buf[3];
	y=y*256;y+=buf[2];
	y=y*256;y+=buf[1];
	y=y*256;y+=buf[0];

	if(buf[7]&0x80) y=-y;

	return y;
}

static int checked_add_int64(int64_t left, int64_t right, int64_t *result)
{
	if ((right > 0 && left > INT64_MAX - right) ||
		(right < 0 && left < INT64_MIN - right))
		return -1;
	*result = left + right;
	return 0;
}

int bspatch(const uint8_t* oldbuf, int64_t oldsize, uint8_t* newbuf, int64_t newsize, struct bspatch_stream* stream)
{
	uint8_t buf[8];
	int64_t oldpos,newpos;
	int64_t nextoldpos;
	int64_t ctrl[3];
	int64_t i;

	if (oldbuf == NULL || newbuf == NULL || stream == NULL ||
		stream->read == NULL || oldsize < 0 || newsize < 0)
		return -1;

	oldpos=0;newpos=0;
	bspatch_progress(stream, 0.0);
	while(newpos<newsize) {
		if (bspatch_cancelled(stream))
			return -1;
		/* Read control data */
		for(i=0;i<=2;i++) {
			if (stream->read(stream, buf, 8))
				return -1;
			ctrl[i]=offtin(buf);
		};

		/* Sanity-check */
		if (ctrl[0]<0 || ctrl[0]>INT_MAX ||
			ctrl[1]<0 || ctrl[1]>INT_MAX ||
			ctrl[0]>newsize-newpos ||
			checked_add_int64(oldpos, ctrl[0], &nextoldpos))
			return -1;

		/* Read diff string */
		if (stream->read(stream, newbuf + newpos, ctrl[0]))
			return -1;

		/* Add old data to diff string */
		for(i=0;i<ctrl[0];i++) {
			if ((i & 0xffff) == 0 && bspatch_cancelled(stream))
				return -1;
			if((oldpos+i>=0) && (oldpos+i<oldsize))
				newbuf[newpos+i]+=oldbuf[oldpos+i];
		}

		/* Adjust pointers */
		newpos+=ctrl[0];
		oldpos=nextoldpos;

		/* Sanity-check */
		if(ctrl[1]>newsize-newpos)
			return -1;

		/* Read extra string */
		if (stream->read(stream, newbuf + newpos, ctrl[1]))
			return -1;

		/* Adjust pointers */
		newpos+=ctrl[1];
		if (checked_add_int64(oldpos, ctrl[2], &nextoldpos))
			return -1;
		oldpos=nextoldpos;
		if (newsize > 0)
			bspatch_progress(stream, (double)newpos / (double)newsize);
	};
	bspatch_progress(stream, 1.0);

	return 0;
}

static int operation_cancelled(const struct bs_operation_options *options)
{
    return options != NULL && options->is_cancelled != NULL &&
        options->is_cancelled(options->opaque);
}

static void operation_progress(
    const struct bs_operation_options *options,
    int phase,
    double progress)
{
    if (options != NULL && options->progress != NULL)
        options->progress(options->opaque, phase, progress);
}

static int input_limit_result(
    const struct bs_operation_options *options,
    int64_t size)
{
    if (options != NULL && options->max_input_bytes > 0 &&
        size > options->max_input_bytes)
        return BS_OPERATION_INPUT_TOO_LARGE;
    return BS_OPERATION_OK;
}

struct bspatch_file_stream_context {
    BZFILE *bz2;
    const struct bs_operation_options *options;
    int result;
};

static int bspatch_file_cancelled(const struct bspatch_stream *stream)
{
    struct bspatch_file_stream_context *context = stream->opaque;
    return operation_cancelled(context->options);
}

static void bspatch_file_progress(const struct bspatch_stream *stream, double progress)
{
    struct bspatch_file_stream_context *context = stream->opaque;
    operation_progress(
        context->options,
        BS_OPERATION_PROCESSING,
        0.15 + progress * 0.70);
}

static int bz2_read(const struct bspatch_stream *stream, void *buffer, int length)
{
    struct bspatch_file_stream_context *context = stream->opaque;
    int offset = 0;

    while (offset < length) {
        int bz2err;
        int chunk = length - offset > BSPATCH_IO_CHUNK
            ? BSPATCH_IO_CHUNK
            : length - offset;
        int count;

        if (operation_cancelled(context->options)) {
            context->result = BS_OPERATION_CANCELLED;
            return -1;
        }
        count = BZ2_bzRead(&bz2err, context->bz2, (uint8_t *)buffer + offset, chunk);
        if (count != chunk) {
            context->result = BS_OPERATION_ERROR;
            return -1;
        }
        offset += count;
    }
    return 0;
}

static off_t readFileToBuffer(
    int fd,
    uint8_t *buffer,
    off_t bufferSize,
    const struct bs_operation_options *options)
{
    off_t bytesRead = 0;
    while (bytesRead < bufferSize) {
        size_t remaining = (size_t)(bufferSize - bytesRead);
        size_t chunk = remaining > BSPATCH_IO_CHUNK ? BSPATCH_IO_CHUNK : remaining;
        ssize_t count;

        if (operation_cancelled(options))
            break;
        count = read(fd, buffer + bytesRead, chunk);
        if (count <= 0)
            break;
        bytesRead += count;
    }
    return bytesRead;
}

static off_t writeFileFromBuffer(
    int fd,
    uint8_t *buffer,
    off_t bufferSize,
    const struct bs_operation_options *options)
{
    off_t bytesWritten = 0;
    while (bytesWritten < bufferSize) {
        size_t remaining = (size_t)(bufferSize - bytesWritten);
        size_t chunk = remaining > BSPATCH_IO_CHUNK ? BSPATCH_IO_CHUNK : remaining;
        ssize_t count;

        if (operation_cancelled(options))
            break;
        count = write(fd, buffer + bytesWritten, chunk);
        if (count <= 0)
            break;
        bytesWritten += count;
        operation_progress(
            options,
            BS_OPERATION_WRITING,
            bufferSize > 0
                ? 0.85 + 0.15 * ((double)bytesWritten / (double)bufferSize)
                : 1.0);
    }
    return bytesWritten;
}

static int bsPatchFileInternal(
    const char *oldFile,
    const char *newFile,
    const char *patchFile,
    int outputFd,
    const struct bs_operation_options *options)
{
    FILE *f = NULL;
    int fd = -1;
    int bz2err;
    int closeResult;
    int result = BS_OPERATION_ERROR;
    int outputCreated = outputFd >= 0;
    uint8_t header[24];
    uint8_t *old = NULL, *new = NULL;
    int64_t oldsize = 0, newsize = 0;
    off_t measuredSize;
    BZFILE *bz2 = NULL;
    struct bspatch_stream stream;
    struct bspatch_file_stream_context context;
    struct stat patchStat;

    memset(&stream, 0, sizeof(stream));
    memset(&context, 0, sizeof(context));
    stream.read = bz2_read;
    stream.is_cancelled = bspatch_file_cancelled;
    stream.progress = bspatch_file_progress;
    stream.opaque = &context;
    context.options = options;
    context.result = BS_OPERATION_ERROR;

    if (oldFile == NULL || newFile == NULL || patchFile == NULL)
        goto cleanup;
    if (operation_cancelled(options)) {
        result = BS_OPERATION_CANCELLED;
        goto cleanup;
    }

    operation_progress(options, BS_OPERATION_READING, 0.0);
    f = fopen(patchFile, "rb");
    if (f == NULL)
        goto cleanup;
    if (fstat(fileno(f), &patchStat) != 0 || patchStat.st_size < 0)
        goto cleanup;
    if (input_limit_result(options, (int64_t)patchStat.st_size) != BS_OPERATION_OK) {
        result = BS_OPERATION_INPUT_TOO_LARGE;
        goto cleanup;
    }
    if (fread(header, 1, 24, f) != 24)
        goto cleanup;
    if (memcmp(header, "ENDSLEY/BSDIFF43", 16) != 0)
        goto cleanup;
    newsize = offtin(header + 16);
    if (newsize < 0 || (uint64_t)newsize > SIZE_MAX - 1)
        goto cleanup;
    if (options != NULL && options->max_output_bytes > 0 &&
        newsize > options->max_output_bytes) {
        result = BS_OPERATION_OUTPUT_TOO_LARGE;
        goto cleanup;
    }
    operation_progress(options, BS_OPERATION_READING, 0.05);

    fd = open(oldFile, O_RDONLY, 0);
    if (fd < 0)
        goto cleanup;
    measuredSize = lseek(fd, 0, SEEK_END);
    if (measuredSize < 0 || (uint64_t)measuredSize > SIZE_MAX - 1)
        goto cleanup;
    oldsize = (int64_t)measuredSize;
    if (input_limit_result(options, oldsize) != BS_OPERATION_OK) {
        result = BS_OPERATION_INPUT_TOO_LARGE;
        goto cleanup;
    }
    old = malloc((size_t)oldsize + 1);
    if (old == NULL || lseek(fd, 0, SEEK_SET) != 0 ||
        readFileToBuffer(fd, old, (off_t)oldsize, options) != (off_t)oldsize) {
        if (operation_cancelled(options)) result = BS_OPERATION_CANCELLED;
        goto cleanup;
    }
    closeResult = close(fd);
    fd = -1;
    if (closeResult != 0)
        goto cleanup;
    operation_progress(options, BS_OPERATION_READING, 0.15);

    new = malloc((size_t)newsize + 1);
    if (new == NULL)
        goto cleanup;
    bz2 = BZ2_bzReadOpen(&bz2err, f, 0, 1, NULL, 0);
    if (bz2 == NULL || bz2err != BZ_OK)
        goto cleanup;
    context.bz2 = bz2;
    if (bspatch(old, oldsize, new, newsize, &stream)) {
        result = context.result;
        if (operation_cancelled(options)) result = BS_OPERATION_CANCELLED;
        goto cleanup;
    }

    BZ2_bzReadClose(&bz2err, bz2);
    bz2 = NULL;
    context.bz2 = NULL;
    closeResult = fclose(f);
    f = NULL;
    if (closeResult != 0)
        goto cleanup;

    fd = outputFd >= 0 ? outputFd : open(newFile, O_CREAT|O_EXCL|O_WRONLY, 0666);
    outputFd = -1;
    if (fd < 0) {
        if (errno == EEXIST) result = BS_OPERATION_DESTINATION_EXISTS;
        goto cleanup;
    }
    outputCreated = 1;
    if (writeFileFromBuffer(fd, new, (off_t)newsize, options) != (off_t)newsize) {
        if (operation_cancelled(options)) result = BS_OPERATION_CANCELLED;
        goto cleanup;
    }
    if (options != NULL && fsync(fd) != 0)
        goto cleanup;
    closeResult = close(fd);
    fd = -1;
    if (closeResult != 0)
        goto cleanup;
    result = BS_OPERATION_OK;

cleanup:
    if (bz2 != NULL)
        BZ2_bzReadClose(&bz2err, bz2);
    if (f != NULL)
        fclose(f);
    if (fd >= 0)
        close(fd);
    if (outputFd >= 0)
        close(outputFd);
    if (result != BS_OPERATION_OK && outputCreated && newFile != NULL)
        unlink(newFile);
    free(new);
    free(old);
    return result;
}

static int create_sibling_temp(const char *destination, char **temporaryPath)
{
    size_t length;
    int fd;

    if (destination == NULL || temporaryPath == NULL)
        return -1;
    length = strlen(destination) + sizeof(".bsdiffpatch.XXXXXX");
    *temporaryPath = malloc(length);
    if (*temporaryPath == NULL)
        return -1;
    snprintf(*temporaryPath, length, "%s.bsdiffpatch.XXXXXX", destination);
    fd = mkstemp(*temporaryPath);
    if (fd < 0) {
        free(*temporaryPath);
        *temporaryPath = NULL;
    }
    return fd;
}

static int reserve_and_rename_temp(
    const char *temporaryPath,
    const char *destination)
{
    int placeholderFd;
    int savedErrno;

    /* Android 7's kernel does not provide renameat2 and its SELinux policy
     * rejects hard links in the app data directory. Reserve the destination
     * name exclusively, then atomically replace our private placeholder. */
    placeholderFd = open(destination, O_CREAT | O_EXCL | O_WRONLY, 0000);
    if (placeholderFd < 0) {
        if (errno == EEXIST)
            return BS_OPERATION_DESTINATION_EXISTS;
        return BS_OPERATION_ERROR;
    }
    if (close(placeholderFd) != 0) {
        savedErrno = errno;
        unlink(destination);
        errno = savedErrno;
        return BS_OPERATION_ERROR;
    }
    if (rename(temporaryPath, destination) == 0)
        return BS_OPERATION_OK;

    savedErrno = errno;
    unlink(destination);
    errno = savedErrno;
    return BS_OPERATION_ERROR;
}

static int commit_sibling_temp(const char *temporaryPath, const char *destination)
{
#if defined(__APPLE__)
    if (renamex_np(temporaryPath, destination, RENAME_EXCL) == 0)
        return BS_OPERATION_OK;
    if (errno == EEXIST)
        return BS_OPERATION_DESTINATION_EXISTS;
    if (errno != ENOTSUP && errno != EINVAL)
        return BS_OPERATION_ERROR;
#elif defined(__linux__) && defined(SYS_renameat2)
    if (syscall(
            SYS_renameat2,
            AT_FDCWD,
            temporaryPath,
            AT_FDCWD,
            destination,
            RENAME_NOREPLACE) == 0)
        return BS_OPERATION_OK;
    if (errno == EEXIST)
        return BS_OPERATION_DESTINATION_EXISTS;
    if (errno != ENOSYS && errno != ENOTSUP && errno != EOPNOTSUPP &&
        errno != EINVAL)
        return BS_OPERATION_ERROR;
#endif

    if (link(temporaryPath, destination) != 0) {
        if (errno == EEXIST)
            return BS_OPERATION_DESTINATION_EXISTS;
        return reserve_and_rename_temp(temporaryPath, destination);
    }

    /* The destination now names the fully-written inode. Removing the private
     * sibling name cannot expose a partial destination or replace another file. */
    unlink(temporaryPath);
    return BS_OPERATION_OK;
}

int bsPatchFile(const char *oldFile, const char *newFile, const char *patchFile)
{
    return bsPatchFileInternal(oldFile, newFile, patchFile, -1, NULL);
}

int bsPatchFileWithOptions(
    const char *oldFile,
    const char *newFile,
    const char *patchFile,
    const struct bs_operation_options *options)
{
    char *temporaryPath = NULL;
    int temporaryFd;
    int result;

    if (newFile == NULL)
        return BS_OPERATION_ERROR;
    if (access(newFile, F_OK) == 0)
        return BS_OPERATION_DESTINATION_EXISTS;
    if (errno != ENOENT)
        return BS_OPERATION_ERROR;

    temporaryFd = create_sibling_temp(newFile, &temporaryPath);
    if (temporaryFd < 0)
        return BS_OPERATION_ERROR;
    result = bsPatchFileInternal(oldFile, temporaryPath, patchFile, temporaryFd, options);
    if (result == BS_OPERATION_OK) {
        if (operation_cancelled(options)) {
            result = BS_OPERATION_CANCELLED;
        } else {
            result = commit_sibling_temp(temporaryPath, newFile);
        }
    }
    if (result != BS_OPERATION_OK)
        unlink(temporaryPath);
    else
        operation_progress(options, BS_OPERATION_WRITING, 1.0);
    free(temporaryPath);
    return result;
}
