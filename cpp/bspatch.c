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

#include <limits.h>
#include "bspatch.h"

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
	while(newpos<newsize) {
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
		for(i=0;i<ctrl[0];i++)
			if((oldpos+i>=0) && (oldpos+i<oldsize))
				newbuf[newpos+i]+=oldbuf[oldpos+i];

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
	};

	return 0;
}

static int bz2_read(const struct bspatch_stream* stream, void* buffer, int length)
{
    int n;
    int bz2err;
    BZFILE* bz2;

    bz2 = (BZFILE*)stream->opaque;
    n = BZ2_bzRead(&bz2err, bz2, buffer, length);
    if (n != length)
        return -1;

    return 0;
}

static off_t readFileToBuffer(int fd, uint8_t* buffer, off_t bufferSize)
{
    off_t bytesRead = 0;
    int ret;
    while (bytesRead < bufferSize)
    {
        ret = read(fd, buffer + bytesRead, bufferSize - bytesRead);
        if (ret > 0)
        {
            bytesRead += ret;
        }
        else
        {
            break;
        }
    }
    return bytesRead;
}

static off_t writeFileFromBuffer(int fd, uint8_t* buffer, off_t bufferSize)
{
    off_t bytesWritten = 0;
    int ret;
    while (bytesWritten < bufferSize)
    {
        ret = write(fd, buffer + bytesWritten, bufferSize - bytesWritten);
        if (ret > 0)
        {
            bytesWritten += ret;
        }
        else
        {
            break;
        }
    }
    return bytesWritten;
}

int bsPatchFile(const char* oldFile, const char* newFile, const char* patchFile)
{
  FILE * f = NULL;
  int fd = -1;
  int bz2err;
  int closeResult;
  int result = -1;
  int outputCreated = 0;
  uint8_t header[24];
  uint8_t *old = NULL, *new = NULL;
  int64_t oldsize = 0, newsize = 0;
  off_t measuredSize;
  BZFILE* bz2 = NULL;
  struct bspatch_stream stream;

  if (oldFile == NULL || newFile == NULL || patchFile == NULL)
      goto cleanup;

  /* Open patch file */
  f = fopen(patchFile, "rb");
  if (f == NULL)
      goto cleanup;

  /* Read header */
  if (fread(header, 1, 24, f) != 24)
      goto cleanup;

  /* Check for appropriate magic */
  if (memcmp(header, "ENDSLEY/BSDIFF43", 16) != 0)
      goto cleanup;

  /* Read lengths from header */
  newsize=offtin(header+16);
  if(newsize < 0 || (uint64_t)newsize > SIZE_MAX - 1)
      goto cleanup;

  /* Close patch file and re-open it via libbzip2 at the right places */
  fd = open(oldFile, O_RDONLY, 0);
  if (fd < 0)
      goto cleanup;
  measuredSize = lseek(fd, 0, SEEK_END);
  if (measuredSize < 0 || (uint64_t)measuredSize > SIZE_MAX - 1)
      goto cleanup;
  oldsize = (int64_t)measuredSize;
  old = malloc((size_t)oldsize + 1);
  if (old == NULL || lseek(fd, 0, SEEK_SET) != 0 ||
      readFileToBuffer(fd, old, (off_t)oldsize) != (off_t)oldsize)
      goto cleanup;
  closeResult = close(fd);
  fd = -1;
  if (closeResult != 0)
      goto cleanup;

  new = malloc((size_t)newsize + 1);
  if (new == NULL)
      goto cleanup;
  bz2 = BZ2_bzReadOpen(&bz2err, f, 0, 1, NULL, 0);
  if (bz2 == NULL || bz2err != BZ_OK)
      goto cleanup;

  stream.read = bz2_read;
  stream.opaque = bz2;
  if (bspatch(old, oldsize, new, newsize, &stream))
      goto cleanup;

  /* Clean up the bzip2 reads */
  BZ2_bzReadClose(&bz2err, bz2);
  bz2 = NULL;
  closeResult = fclose(f);
  f = NULL;
  if (closeResult != 0)
      goto cleanup;

  /* Write the new file */
  fd = open(newFile, O_CREAT|O_EXCL|O_WRONLY, 0666);
  if (fd < 0)
      goto cleanup;
  outputCreated = 1;
  if (writeFileFromBuffer(fd, new, (off_t)newsize) != (off_t)newsize)
      goto cleanup;
  closeResult = close(fd);
  fd = -1;
  if (closeResult != 0)
      goto cleanup;
  result = 0;

cleanup:
  if (bz2 != NULL)
      BZ2_bzReadClose(&bz2err, bz2);
  if (f != NULL)
      fclose(f);
  if (fd >= 0)
      close(fd);
  if (result != 0 && outputCreated && newFile != NULL)
      unlink(newFile);
  free(new);
  free(old);
  return result;
}
