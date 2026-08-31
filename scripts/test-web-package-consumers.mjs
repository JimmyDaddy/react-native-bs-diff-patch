if (
  process.env.SDK_CONSUMER_PROFILE &&
  process.env.SDK_CONSUMER_PROFILE !== 'web'
) {
  throw new Error(
    `test-web-package-consumers.mjs requires SDK_CONSUMER_PROFILE=web, received ${process.env.SDK_CONSUMER_PROFILE}`
  );
}

process.env.SDK_CONSUMER_PROFILE = 'web';
await import('./test-sdk-consumers.mjs');
