@echo off
setlocal
set "LOCAL_YTDLP=%~dp0bin\yt-dlp.exe"
if exist "%LOCAL_YTDLP%" (
  "%LOCAL_YTDLP%" %*
) else (
  yt-dlp %*
)
