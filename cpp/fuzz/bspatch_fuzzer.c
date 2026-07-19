#include <stddef.h>
#include <stdint.h>
#include <string.h>

#ifdef BSDIFFPATCH_STANDALONE_FUZZ
#include <stdio.h>
#include <stdlib.h>
#endif

#include "bspatch.h"

struct fuzz_input {
  const uint8_t *data;
  size_t size;
  size_t offset;
};

static int fuzz_read(
    const struct bspatch_stream *stream,
    void *buffer,
    int length)
{
  struct fuzz_input *input = (struct fuzz_input *)stream->opaque;

  if (length < 0 || (size_t)length > input->size - input->offset)
    return -1;

  memcpy(buffer, input->data + input->offset, (size_t)length);
  input->offset += (size_t)length;
  return 0;
}

int LLVMFuzzerTestOneInput(const uint8_t *data, size_t size)
{
  uint8_t old_buffer[64] = {0};
  uint8_t new_buffer[64] = {0};
  struct fuzz_input input;
  struct bspatch_stream stream;
  size_t old_size;
  size_t new_size;
  size_t copied_old_size;

  if (size < 2)
    return 0;

  old_size = data[0] % sizeof(old_buffer);
  new_size = data[1] % sizeof(new_buffer);
  copied_old_size = old_size < size - 2 ? old_size : size - 2;
  memcpy(old_buffer, data + 2, copied_old_size);

  input.data = data + 2 + copied_old_size;
  input.size = size - 2 - copied_old_size;
  input.offset = 0;
  stream.opaque = &input;
  stream.read = fuzz_read;

  (void)bspatch(
      old_buffer,
      (int64_t)old_size,
      new_buffer,
      (int64_t)new_size,
      &stream);
  return 0;
}

#ifdef BSDIFFPATCH_STANDALONE_FUZZ
static uint32_t next_random(uint32_t *state)
{
  uint32_t value = *state;
  value ^= value << 13;
  value ^= value >> 17;
  value ^= value << 5;
  *state = value;
  return value;
}

int main(int argc, char **argv)
{
  uint8_t input[512];
  uint32_t state = 0x42534450u;
  long runs = argc > 1 ? strtol(argv[1], NULL, 10) : 5000;
  long run;

  for (run = 0; run < runs; run++) {
    size_t size = (size_t)(next_random(&state) % sizeof(input));
    size_t index;
    for (index = 0; index < size; index++)
      input[index] = (uint8_t)next_random(&state);
    LLVMFuzzerTestOneInput(input, size);
  }

  printf("Standalone sanitizer fuzz passed %ld runs\n", runs);
  return 0;
}
#endif
