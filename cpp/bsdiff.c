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

#include "bsdiff.h"
#include "bsdiffpatch_operation.h"

#include <errno.h>
#include <limits.h>
#include <string.h>

#if defined(__APPLE__)
#include <sys/stdio.h>
#elif defined(__linux__)
#include <linux/fs.h>
#include <sys/syscall.h>
#endif

#define MIN(x,y) (((x)<(y)) ? (x) : (y))
#define BSDIFF_IO_CHUNK (64 * 1024)

static int bsdiff_cancelled(struct bsdiff_stream *stream)
{
	return stream->is_cancelled != NULL && stream->is_cancelled(stream);
}

static void bsdiff_progress(struct bsdiff_stream *stream, double progress)
{
	if (stream->progress != NULL)
		stream->progress(stream, progress);
}

static int split(int64_t *I,int64_t *V,int64_t start,int64_t len,int64_t h,
	struct bsdiff_stream *stream)
{
	int64_t i,j,k,x,tmp,jj,kk;

	if (bsdiff_cancelled(stream)) return -1;
	if(len<16) {
		for(k=start;k<start+len;k+=j) {
			if (bsdiff_cancelled(stream)) return -1;
			j=1;x=V[I[k]+h];
			for(i=1;k+i<start+len;i++) {
				if(V[I[k+i]+h]<x) {
					x=V[I[k+i]+h];
					j=0;
				};
				if(V[I[k+i]+h]==x) {
					tmp=I[k+j];I[k+j]=I[k+i];I[k+i]=tmp;
					j++;
				};
			};
			for(i=0;i<j;i++) V[I[k+i]]=k+j-1;
			if(j==1) I[k]=-1;
		};
		return 0;
	};

	x=V[I[start+len/2]+h];
	jj=0;kk=0;
	for(i=start;i<start+len;i++) {
		if (((i-start) & 0x3fff) == 0 && bsdiff_cancelled(stream)) return -1;
		if(V[I[i]+h]<x) jj++;
		if(V[I[i]+h]==x) kk++;
	};
	jj+=start;kk+=jj;

	i=start;j=0;k=0;
	while(i<jj) {
		if (((i-start) & 0x3fff) == 0 && bsdiff_cancelled(stream)) return -1;
		if(V[I[i]+h]<x) {
			i++;
		} else if(V[I[i]+h]==x) {
			tmp=I[i];I[i]=I[jj+j];I[jj+j]=tmp;
			j++;
		} else {
			tmp=I[i];I[i]=I[kk+k];I[kk+k]=tmp;
			k++;
		};
	};

	while(jj+j<kk) {
		if ((j & 0x3fff) == 0 && bsdiff_cancelled(stream)) return -1;
		if(V[I[jj+j]+h]==x) {
			j++;
		} else {
			tmp=I[jj+j];I[jj+j]=I[kk+k];I[kk+k]=tmp;
			k++;
		};
	};

	if(jj>start && split(I,V,start,jj-start,h,stream)) return -1;

	for(i=0;i<kk-jj;i++) {
		if ((i & 0x3fff) == 0 && bsdiff_cancelled(stream)) return -1;
		V[I[jj+i]]=kk-1;
	}
	if(jj==kk-1) I[jj]=-1;

	if(start+len>kk && split(I,V,kk,start+len-kk,h,stream)) return -1;
	return 0;
}

static int qsufsort(int64_t *I,int64_t *V,const uint8_t *old,int64_t oldsize,
	struct bsdiff_stream *stream)
{
	int64_t buckets[256];
	int64_t i,h,len;

	for(i=0;i<256;i++) buckets[i]=0;
	for(i=0;i<oldsize;i++) {
		if ((i & 0x3fff) == 0 && bsdiff_cancelled(stream)) return -1;
		buckets[old[i]]++;
	}
	for(i=1;i<256;i++) buckets[i]+=buckets[i-1];
	for(i=255;i>0;i--) buckets[i]=buckets[i-1];
	buckets[0]=0;

	for(i=0;i<oldsize;i++) I[++buckets[old[i]]]=i;
	I[0]=oldsize;
	for(i=0;i<oldsize;i++) {
		if ((i & 0x3fff) == 0 && bsdiff_cancelled(stream)) return -1;
		V[i]=buckets[old[i]];
	}
	V[oldsize]=0;
	for(i=1;i<256;i++) if(buckets[i]==buckets[i-1]+1) I[buckets[i]]=-1;
	I[0]=-1;

	for(h=1;I[0]!=-(oldsize+1);h+=h) {
		if (bsdiff_cancelled(stream)) return -1;
		len=0;
		for(i=0;i<oldsize+1;) {
			if(I[i]<0) {
				len-=I[i];
				i-=I[i];
			} else {
				if(len) I[i-len]=-len;
				len=V[I[i]]+1-i;
				if (split(I,V,i,len,h,stream)) return -1;
				i+=len;
				len=0;
			};
		};
		if(len) I[i-len]=-len;
	};

	for(i=0;i<oldsize+1;i++) {
		if ((i & 0x3fff) == 0 && bsdiff_cancelled(stream)) return -1;
		I[V[i]]=i;
	}
	return 0;
}

static int64_t matchlen(const uint8_t *old,int64_t oldsize,const uint8_t *new,int64_t newsize)
{
	int64_t i;

	for(i=0;(i<oldsize)&&(i<newsize);i++)
		if(old[i]!=new[i]) break;

	return i;
}

static int64_t search(const int64_t *I,const uint8_t *old,int64_t oldsize, const uint8_t *new,int64_t newsize,int64_t st,int64_t en,int64_t *pos)
{
	int64_t x,y,cmpsize;
	int32_t res;

	if(en-st<2) {
		x=matchlen(old+I[st],oldsize-I[st],new,newsize);
		y=matchlen(old+I[en],oldsize-I[en],new,newsize);

		if(x>y) {
			*pos=I[st];
			return x;
		} else {
			*pos=I[en];
			return y;
		}
	};

	x=st+(en-st)/2;
	cmpsize=MIN(oldsize-I[x],newsize);
	res=memcmp(old+I[x],new,cmpsize);
	if((res<0) || ((res==0) && (cmpsize<newsize))) {
		return search(I,old,oldsize,new,newsize,x,en,pos);
	} else {
		return search(I,old,oldsize,new,newsize,st,x,pos);
	};
}

static void offtout(int64_t x,uint8_t *buf)
{
	int64_t y;

	if(x<0) y=-x; else y=x;

	buf[0]=y%256;y-=buf[0];
	y=y/256;buf[1]=y%256;y-=buf[1];
	y=y/256;buf[2]=y%256;y-=buf[2];
	y=y/256;buf[3]=y%256;y-=buf[3];
	y=y/256;buf[4]=y%256;y-=buf[4];
	y=y/256;buf[5]=y%256;y-=buf[5];
	y=y/256;buf[6]=y%256;y-=buf[6];
	y=y/256;buf[7]=y%256;

	if(x<0) buf[7]|=0x80;
}

static int64_t writedata(struct bsdiff_stream* stream, const void* buffer, int64_t length)
{
	int64_t result = 0;

	while (length > 0)
	{
		const int smallsize = (int)MIN(length, BSDIFF_IO_CHUNK);
		if (bsdiff_cancelled(stream))
			return -1;
		const int writeresult = stream->write(stream, buffer, smallsize);
		if (writeresult == -1)
		{
			return -1;
		}

		result += writeresult;
		length -= smallsize;
		buffer = (uint8_t*)buffer + smallsize;
	}

	return result;
}

struct bsdiff_request
{
	const uint8_t* old;
	int64_t oldsize;
	const uint8_t* new;
	int64_t newsize;
	struct bsdiff_stream* stream;
	int64_t *I;
	uint8_t *buffer;
};

static int bsdiff_internal(const struct bsdiff_request req)
{
	int64_t *I,*V;
	int64_t scan,pos,len;
	int64_t lastscan,lastpos,lastoffset;
	int64_t oldscore,scsc;
	int64_t s,Sf,lenf,Sb,lenb;
	int64_t overlap,Ss,lens;
	int64_t i;
	uint8_t *buffer;
	uint8_t buf[8 * 3];

	if((V=req.stream->malloc((req.oldsize+1)*sizeof(int64_t)))==NULL) return -1;
	I = req.I;

	bsdiff_progress(req.stream, 0.0);
	if (qsufsort(I,V,req.old,req.oldsize,req.stream)) {
		req.stream->free(V);
		return -1;
	}
	req.stream->free(V);
	bsdiff_progress(req.stream, 0.25);

	buffer = req.buffer;

	/* Compute the differences, writing ctrl as we go */
	scan=0;len=0;pos=0;
	lastscan=0;lastpos=0;lastoffset=0;
	while(scan<req.newsize) {
		if (bsdiff_cancelled(req.stream)) return -1;
		if (req.newsize > 0)
			bsdiff_progress(req.stream, 0.25 + 0.75 * ((double)scan / (double)req.newsize));
		oldscore=0;

		for(scsc=scan+=len;scan<req.newsize;scan++) {
			if ((scan & 0x3fff) == 0 && bsdiff_cancelled(req.stream))
				return -1;
			len=search(I,req.old,req.oldsize,req.new+scan,req.newsize-scan,
					0,req.oldsize,&pos);

			for(;scsc<scan+len;scsc++) {
				if ((scsc & 0x3fff) == 0 && bsdiff_cancelled(req.stream))
					return -1;
			if((scsc+lastoffset<req.oldsize) &&
				(req.old[scsc+lastoffset] == req.new[scsc]))
				oldscore++;
			}

			if(((len==oldscore) && (len!=0)) ||
				(len>oldscore+8)) break;

			if((scan+lastoffset<req.oldsize) &&
				(req.old[scan+lastoffset] == req.new[scan]))
				oldscore--;
		};

		if((len!=oldscore) || (scan==req.newsize)) {
			s=0;Sf=0;lenf=0;
			for(i=0;(lastscan+i<scan)&&(lastpos+i<req.oldsize);) {
				if ((i & 0x3fff) == 0 && bsdiff_cancelled(req.stream)) return -1;
				if(req.old[lastpos+i]==req.new[lastscan+i]) s++;
				i++;
				if(s*2-i>Sf*2-lenf) { Sf=s; lenf=i; };
			};

			lenb=0;
			if(scan<req.newsize) {
				s=0;Sb=0;
				for(i=1;(scan>=lastscan+i)&&(pos>=i);i++) {
					if ((i & 0x3fff) == 0 && bsdiff_cancelled(req.stream)) return -1;
					if(req.old[pos-i]==req.new[scan-i]) s++;
					if(s*2-i>Sb*2-lenb) { Sb=s; lenb=i; };
				};
			};

			if(lastscan+lenf>scan-lenb) {
				overlap=(lastscan+lenf)-(scan-lenb);
				s=0;Ss=0;lens=0;
				for(i=0;i<overlap;i++) {
					if ((i & 0x3fff) == 0 && bsdiff_cancelled(req.stream)) return -1;
					if(req.new[lastscan+lenf-overlap+i]==
					   req.old[lastpos+lenf-overlap+i]) s++;
					if(req.new[scan-lenb+i]==
					   req.old[pos-lenb+i]) s--;
					if(s>Ss) { Ss=s; lens=i+1; };
				};

				lenf+=lens-overlap;
				lenb-=lens;
			};

			offtout(lenf,buf);
			offtout((scan-lenb)-(lastscan+lenf),buf+8);
			offtout((pos-lenb)-(lastpos+lenf),buf+16);

			/* Write control data */
			if (writedata(req.stream, buf, sizeof(buf)))
				return -1;

			/* Write diff data */
			for(i=0;i<lenf;i++) {
				if ((i & 0x3fff) == 0 && bsdiff_cancelled(req.stream)) return -1;
				buffer[i]=req.new[lastscan+i]-req.old[lastpos+i];
			}
			if (writedata(req.stream, buffer, lenf))
				return -1;

			/* Write extra data */
			for(i=0;i<(scan-lenb)-(lastscan+lenf);i++) {
				if ((i & 0x3fff) == 0 && bsdiff_cancelled(req.stream)) return -1;
				buffer[i]=req.new[lastscan+lenf+i];
			}
			if (writedata(req.stream, buffer, (scan-lenb)-(lastscan+lenf)))
				return -1;

			lastscan=scan-lenb;
			lastpos=pos-lenb;
			lastoffset=pos-scan;
		};
	};
	bsdiff_progress(req.stream, 1.0);

	return 0;
}

int bsdiff(const uint8_t* oldBuf, int64_t oldsize, const uint8_t* newBuf, int64_t newsize, struct bsdiff_stream* stream)
{
	int result;
	struct bsdiff_request req;

	if (oldBuf == NULL || newBuf == NULL || stream == NULL ||
		stream->malloc == NULL || stream->free == NULL || stream->write == NULL ||
		oldsize < 0 || newsize < 0 ||
		(uint64_t)oldsize > (SIZE_MAX / sizeof(int64_t)) - 1 ||
		(uint64_t)newsize > SIZE_MAX - 1)
		return -1;

	if((req.I=stream->malloc((oldsize+1)*sizeof(int64_t)))==NULL)
		return -1;

	if((req.buffer=stream->malloc(newsize+1))==NULL)
	{
		stream->free(req.I);
		return -1;
	}

	req.old = oldBuf;
	req.oldsize = oldsize;
	req.new = newBuf;
	req.newsize = newsize;
	req.stream = stream;

	result = bsdiff_internal(req);

	stream->free(req.buffer);
	stream->free(req.I);

	return result;
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

static off_t readFileToBuffer(
    int fd,
    uint8_t *buffer,
    off_t bufferSize,
    const struct bs_operation_options *options)
{
    off_t bytesRead = 0;
    while (bytesRead < bufferSize) {
        size_t remaining = (size_t)(bufferSize - bytesRead);
        size_t chunk = MIN(remaining, BSDIFF_IO_CHUNK);
        ssize_t ret;

        if (operation_cancelled(options))
            break;
        ret = read(fd, buffer + bytesRead, chunk);
        if (ret <= 0)
            break;
        bytesRead += ret;
    }
    return bytesRead;
}

struct bsdiff_file_stream_context {
    BZFILE *bz2;
    FILE *file;
    const struct bs_operation_options *options;
    int result;
};

static int bsdiff_file_cancelled(struct bsdiff_stream *stream)
{
    struct bsdiff_file_stream_context *context = stream->opaque;
    return operation_cancelled(context->options);
}

static void bsdiff_file_progress(struct bsdiff_stream *stream, double progress)
{
    struct bsdiff_file_stream_context *context = stream->opaque;
    operation_progress(
        context->options,
        BS_OPERATION_PROCESSING,
        0.15 + progress * 0.70);
}

static int bz2_write(struct bsdiff_stream *stream, const void *buffer, int size)
{
    struct bsdiff_file_stream_context *context = stream->opaque;
    int bz2err;
    long position;

    if (operation_cancelled(context->options)) {
        context->result = BS_OPERATION_CANCELLED;
        return -1;
    }

    BZ2_bzWrite(&bz2err, context->bz2, (void *)buffer, size);
    if (bz2err != BZ_STREAM_END && bz2err != BZ_OK) {
        context->result = BS_OPERATION_ERROR;
        return -1;
    }

    position = ftell(context->file);
    if (context->options != NULL && context->options->max_output_bytes > 0 &&
        position >= 0 && position > context->options->max_output_bytes) {
        context->result = BS_OPERATION_OUTPUT_TOO_LARGE;
        return -1;
    }
    return 0;
}

static int bsDiffFileInternal(
    const char *oldFile,
    const char *newFile,
    const char *patchFile,
    int outputFd,
    const struct bs_operation_options *options)
{
    int fd = -1;
    int bz2err;
    int closeResult;
    int outputCreated = outputFd >= 0;
    int result = BS_OPERATION_ERROR;
    uint8_t *old = NULL, *new = NULL;
    int64_t oldsize = 0, newsize = 0;
    off_t measuredSize;
    uint8_t buf[8];
    FILE *pf = NULL;
    struct bsdiff_stream stream;
    BZFILE *bz2 = NULL;
    struct bsdiff_file_stream_context context;

    memset(&stream, 0, sizeof(stream));
    memset(&context, 0, sizeof(context));
    stream.malloc = malloc;
    stream.free = free;
    stream.write = bz2_write;
    stream.is_cancelled = bsdiff_file_cancelled;
    stream.progress = bsdiff_file_progress;
    stream.opaque = &context;
    context.file = NULL;
    context.options = options;
    context.result = BS_OPERATION_ERROR;

    if (oldFile == NULL || newFile == NULL || patchFile == NULL)
        goto cleanup;
    if (operation_cancelled(options)) {
        result = BS_OPERATION_CANCELLED;
        goto cleanup;
    }

    operation_progress(options, BS_OPERATION_READING, 0.0);
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
    operation_progress(options, BS_OPERATION_READING, 0.075);

    fd = open(newFile, O_RDONLY, 0);
    if (fd < 0)
        goto cleanup;
    measuredSize = lseek(fd, 0, SEEK_END);
    if (measuredSize < 0 || (uint64_t)measuredSize > SIZE_MAX - 1)
        goto cleanup;
    newsize = (int64_t)measuredSize;
    if (input_limit_result(options, newsize) != BS_OPERATION_OK) {
        result = BS_OPERATION_INPUT_TOO_LARGE;
        goto cleanup;
    }
    new = malloc((size_t)newsize + 1);
    if (new == NULL || lseek(fd, 0, SEEK_SET) != 0 ||
        readFileToBuffer(fd, new, (off_t)newsize, options) != (off_t)newsize) {
        if (operation_cancelled(options)) result = BS_OPERATION_CANCELLED;
        goto cleanup;
    }
    closeResult = close(fd);
    fd = -1;
    if (closeResult != 0)
        goto cleanup;
    operation_progress(options, BS_OPERATION_READING, 0.15);

    if (options != NULL && options->max_output_bytes > 0 &&
        options->max_output_bytes < 24) {
        result = BS_OPERATION_OUTPUT_TOO_LARGE;
        goto cleanup;
    }

    fd = outputFd >= 0 ? outputFd : open(patchFile, O_CREAT|O_EXCL|O_WRONLY, 0666);
    outputFd = -1;
    if (fd < 0) {
        if (errno == EEXIST) result = BS_OPERATION_DESTINATION_EXISTS;
        goto cleanup;
    }
    outputCreated = 1;
    pf = fdopen(fd, "wb");
    if (pf == NULL)
        goto cleanup;
    fd = -1;
    context.file = pf;

    offtout(newsize, buf);
    if (fwrite("ENDSLEY/BSDIFF43", 16, 1, pf) != 1 ||
        fwrite(buf, sizeof(buf), 1, pf) != 1)
        goto cleanup;

    bz2 = BZ2_bzWriteOpen(&bz2err, pf, 9, 0, 0);
    if (bz2 == NULL || bz2err != BZ_OK)
        goto cleanup;
    context.bz2 = bz2;

    if (bsdiff(old, oldsize, new, newsize, &stream)) {
        result = context.result;
        if (operation_cancelled(options)) result = BS_OPERATION_CANCELLED;
        goto cleanup;
    }

    BZ2_bzWriteClose(&bz2err, bz2, 0, NULL, NULL);
    bz2 = NULL;
    context.bz2 = NULL;
    if (bz2err != BZ_OK)
        goto cleanup;
    if (options != NULL && options->max_output_bytes > 0) {
        long position = ftell(pf);
        if (position < 0 || position > options->max_output_bytes) {
            result = BS_OPERATION_OUTPUT_TOO_LARGE;
            goto cleanup;
        }
    }
    if (operation_cancelled(options)) {
        result = BS_OPERATION_CANCELLED;
        goto cleanup;
    }
    operation_progress(options, BS_OPERATION_WRITING, 0.95);
    if (fflush(pf) != 0 || fsync(fileno(pf)) != 0)
        goto cleanup;
    closeResult = fclose(pf);
    pf = NULL;
    if (closeResult != 0)
        goto cleanup;
    result = BS_OPERATION_OK;

cleanup:
    if (bz2 != NULL)
        BZ2_bzWriteClose(&bz2err, bz2, 1, NULL, NULL);
    if (pf != NULL)
        fclose(pf);
    if (fd >= 0)
        close(fd);
    if (outputFd >= 0)
        close(outputFd);
    if (result != BS_OPERATION_OK && outputCreated && patchFile != NULL)
        unlink(patchFile);
    free(old);
    free(new);
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
        return BS_OPERATION_ERROR;
    }

    /* The destination now names the fully-written inode. Removing the private
     * sibling name cannot expose a partial destination or replace another file. */
    unlink(temporaryPath);
    return BS_OPERATION_OK;
}

int bsDiffFile(const char *oldFile, const char *newFile, const char *patchFile)
{
    return bsDiffFileInternal(oldFile, newFile, patchFile, -1, NULL);
}

int bsDiffFileWithOptions(
    const char *oldFile,
    const char *newFile,
    const char *patchFile,
    const struct bs_operation_options *options)
{
    char *temporaryPath = NULL;
    int temporaryFd = -1;
    int result;

    if (patchFile == NULL)
        return BS_OPERATION_ERROR;
    if (access(patchFile, F_OK) == 0)
        return BS_OPERATION_DESTINATION_EXISTS;
    if (errno != ENOENT)
        return BS_OPERATION_ERROR;

    temporaryFd = create_sibling_temp(patchFile, &temporaryPath);
    if (temporaryFd < 0)
        return BS_OPERATION_ERROR;
    result = bsDiffFileInternal(oldFile, newFile, temporaryPath, temporaryFd, options);
    temporaryFd = -1;
    if (result == BS_OPERATION_OK) {
        if (operation_cancelled(options)) {
            result = BS_OPERATION_CANCELLED;
        } else {
            result = commit_sibling_temp(temporaryPath, patchFile);
        }
    }
    if (result != BS_OPERATION_OK)
        unlink(temporaryPath);
    else
        operation_progress(options, BS_OPERATION_WRITING, 1.0);
    free(temporaryPath);
    return result;
}
