param([string]$GameVersion = '1.21.4')
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('Crew Ship launch tests ' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $testRoot | Out-Null
$java = Get-ChildItem "$env:LOCALAPPDATA\Crew.Ship\runtimes\java-21" -Filter java.exe -Recurse | Select-Object -First 1 -ExpandProperty FullName
if (!$java) { throw 'Java 21 is required for this test matrix.' }
$headers = @{ 'User-Agent' = 'Crew.Ship/launch-regression (https://github.com/VirtualFox3/crew.ship)' }
function Json($url) { Invoke-RestMethod $url -Headers $headers -TimeoutSec 30 }
function CheckJar($name, $url) {
    try {
        $jar = Join-Path $testRoot "$name.jar"
        & curl.exe --fail --location --silent --show-error --max-time 60 -A $headers['User-Agent'] -o $jar $url
        if ($LASTEXITCODE -ne 0) { throw 'Official artifact download failed or timed out.' }
        $output = & $java --dry-run -jar $jar 2>&1
        if ($LASTEXITCODE -ne 0) { throw ($output -join "`n") }
        Write-Output "$name : PASS Java 21 main-class loading (path contains spaces)"
    } catch { Write-Output "$name : FAIL $($_.Exception.Message)" }
}
Write-Output "Isolated test artifacts: $testRoot"
Write-Output 'Dry-run only: no Minecraft main method, world creation, or EULA acceptance.'
$manifest = Json 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'
$meta = Json (($manifest.versions | Where-Object id -eq $GameVersion).url)
CheckJar 'vanilla' $meta.downloads.server.url
$loaders = Json "https://meta.fabricmc.net/v2/versions/loader/$GameVersion"
$installers = Json 'https://meta.fabricmc.net/v2/versions/installer'
$loader = $loaders[0].loader.version
$installer = $installers[0].version
CheckJar 'fabric' "https://meta.fabricmc.net/v2/versions/loader/$GameVersion/$loader/$installer/server/jar"
$builds = Json "https://fill.papermc.io/v3/projects/paper/versions/$GameVersion/builds"
CheckJar 'paper' $builds[0].downloads.'server:default'.url
CheckJar 'purpur' "https://api.purpurmc.org/v2/purpur/$GameVersion/latest/download"
$forge = [xml](Invoke-WebRequest -UseBasicParsing -TimeoutSec 30 'https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml').Content
$forgeVersion = @($forge.metadata.versioning.versions.version | Where-Object { $_ -like "$GameVersion-*" })[-1]
CheckJar 'forge-installer' "https://maven.minecraftforge.net/net/minecraftforge/forge/$forgeVersion/forge-$forgeVersion-installer.jar"
$neo = [xml](Invoke-WebRequest -UseBasicParsing -TimeoutSec 30 'https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml').Content
$neoVersion = @($neo.metadata.versioning.versions.version | Where-Object { $_ -match '^21\.4\.\d+$' })[-1]
CheckJar 'neoforge-installer' "https://maven.neoforged.net/releases/net/neoforged/neoforge/$neoVersion/neoforge-$neoVersion-installer.jar"
Write-Output 'Forge/NeoForge installer checks do not prove installed server startup.'
