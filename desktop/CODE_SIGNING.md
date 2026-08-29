# Windows release signing

Windows may show SmartScreen warnings for a new unsigned application. The practical fix is a publicly trusted Authenticode certificate (or Azure Artifact Signing), not a self-signed certificate. Signing proves who published the installer; reputation then builds over time.

## GitHub release setup

1. Obtain a public Windows code-signing certificate from a trusted provider, or configure Azure Artifact Signing for the organization.
2. Export the certificate as a password-protected `.pfx` file. Never commit this file.
3. Add these GitHub Actions repository secrets:
   - `HOWL_CODE_SIGN_PFX_BASE64`: the base64 encoding of the `.pfx` file.
   - `HOWL_CODE_SIGN_PFX_PASSWORD`: its export password.
4. Optionally add `HOWL_TIMESTAMP_URL`; otherwise the workflow uses DigiCert's timestamp service.
5. Push a `desktop-v*` tag. The release workflow signs the NSIS `.exe` and MSI, verifies their signatures, and replaces the unsigned release assets.

The workflow stays usable without these secrets, but releases remain unsigned until they are supplied. Do not use a self-signed certificate for public releases: it only helps on machines where the certificate was manually trusted.

Microsoft Store distribution is another option: Microsoft signs Store packages as part of submission. Keep the publisher identity consistent; it helps Windows establish reputation.
