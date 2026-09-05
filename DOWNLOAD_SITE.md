# Crew.Ship official download site
The repository root is a Next.js project ready for Vercel.
Import VirtualFox3/Crew.Ship, use the repository root, choose Next.js,
and keep the default npm install and npm run build commands.
The public homepage and /download require no Supabase environment variables.
Existing account/dashboard features still require their existing configuration.

The Windows button resolves the newest published desktop installer through
/download/windows. Add ?format=msi for MSI. GitHub errors fall back to the
official releases list; draft and prerelease builds are excluded.

IMPORTANT: Crew.Ship is currently a private GitHub repository. Anonymous
visitors cannot access its release assets. Before public launch, upload the
installers to public artifact hosting (or a separate public release repository)
and set CREWSHIP_WINDOWS_EXE_URL and CREWSHIP_WINDOWS_MSI_URL in Vercel to
their public HTTPS download URLs. These override GitHub discovery. Do not put
GitHub tokens or private signed credentials in those URLs. Alternatively,
the owner can choose to make the release repository public. No repository
visibility changes have been made by this implementation.

Run npm run dev to preview, and npm run build to validate production.
Artwork is original code in desktop/scripts/generate_pixel_ship_icon.py.
Run python desktop/scripts/generate_pixel_ship_icon.py to regenerate the
matching SVG, PNG, ICO and ICNS assets. The bundled Minecraft Ten font is
used for display text. No image-generation service is used.
