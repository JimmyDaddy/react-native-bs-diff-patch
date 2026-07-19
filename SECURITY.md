# Security policy

## Supported versions

Security fixes are provided for the latest published minor release.

| Version | Supported |
| ------- | --------- |
| Latest  | Yes       |
| Older   | No        |

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability. Use
[GitHub private vulnerability reporting](https://github.com/JimmyDaddy/react-native-bs-diff-patch/security/advisories/new)
and include the affected version, platform, architecture mode, reproduction
steps, and impact.

You should receive an acknowledgement within 3 business days. We will confirm
the assessment and planned disclosure timeline after reproducing the report.

## Patch trust boundary

This library validates its patch format and rejects malformed inputs, but it
does not authenticate patches. Applications distributing remote patches must
verify a trusted signature or digest before applying a patch and verify the
restored output before replacing application data. Use the Web resource limits
for untrusted browser inputs and enforce equivalent product-specific limits
around native file operations.
