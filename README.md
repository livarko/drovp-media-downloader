# drovp-media-downloader

Utility to backup media from various services using [yt-dlp](https://github.com/yt-dlp/yt-dlp).

For the list of supported services, see ([yt-dlp's list of extractors](https://github.com/yt-dlp/yt-dlp/tree/master/yt_dlp/extractor)).

## Usage

Set up a profile, and drag & drop or copy & paste any link or URL of a desired media's page into it.

## Authentication

For authenticating to websites, place `.netrc` in your home directory by following [yt-dlp's "Authentication with .netrc file" documentation](https://github.com/yt-dlp/yt-dlp#authentication-with-netrc-file).

For example, to authenticate to twitch.tv you'd place this line to your `~/.netrc` file:

```
machine twitch login my_twitch_account_name password my_twitch_password
```

`twitch` in this case is the extractor name. You can see all available extractor names in [yt-dlp's list of extractors](https://github.com/yt-dlp/yt-dlp/tree/master/yt_dlp/extractor).
