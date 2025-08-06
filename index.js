const path = require('path');
const fs = require('fs').promises;
const exec = require('util').promisify(require('child_process').exec);

const EXECUTABLE_NAME = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
const DOWNLOAD_URL_BASE = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/';

async function loadDependency(utils) {
  const executablePath = path.join(utils.dataPath, EXECUTABLE_NAME);
  const {stdout} = await exec(`"${executablePath}" --version`);
  return {version: stdout, payload: executablePath};
}

async function installDependency(utils) {
  await utils.cleanup(utils.dataPath);
  const downloadedFile = await utils.download(`${DOWNLOAD_URL_BASE}${EXECUTABLE_NAME}`, utils.dataPath, {onProgress: utils.progress});
  await fs.chmod(path.join(utils.dataPath, downloadedFile), 0o755);
}

module.exports = (plugin) => {
  plugin.registerDependency('yt-dlp', {
    load: loadDependency,
    install: installDependency,
  });

  plugin.registerProcessor('media-downloader', {
    main: 'processor.js',
    description: 'Downloads media from various services.',
    dependencies: ['yt-dlp', '@drovp/ffmpeg:ffmpeg', '@drovp/ffmpeg:ffprobe'],
    accepts: {
      urls: true,
    },
    // Thread pool by hostname, fallback to `media-downloader`
    threadType: ({url}) => {
      let threadType = 'media-downloader';
      try {
        threadType = new URL(url).hostname;
      } catch {}
      return threadType;
    },
    threadTypeDescription: `Thread pools are created per input URL hostname.`,
    options: [
      {
        name: 'destination',
        type: 'path',
        kind: 'directory',
        default: '',
        title: 'Destination',
        description: `Download directory. If empty, your system's Downloads directory will be used. Hold <kbd>Ctrl</kbd> on drop to prompt for each drop.<br>
        Also supports variables:<br>
        <b><code>\${tmp}</code></b> - platform's tmp directory<br>
        <b><code>\${home}</code></b> - platform's home directory<br>
        <b><code>\${downloads}</code></b> - platform's downloads directory<br>
        <b><code>\${documents}</code></b> - platform's documents directory<br>
        <b><code>\${pictures}</code></b> - platform's pictures directory<br>
        <b><code>\${music}</code></b> - platform's music directory<br>
        <b><code>\${videos}</code></b> - platform's videos directory<br>
        <b><code>\${desktop}</code></b> - platform's desktop directory<br>
        `,
      },
      {
        name: 'askDestination',
        type: 'boolean',
        default: false,
        title: 'Ask destination',
        description: `Always ask where to save files when dropped into a profile.`,
      },
      {
        name: 'mode',
        type: 'select',
        options: {
          download: 'Download',
          extractAudio: 'Extract audio',
        },
        default: 'download',
        title: 'Mode',
        description: (value) =>
          value === 'download'
            ? `Your basic video download option.`
            : `Only extract the audio of best available quality. Tries to download only the audio track when possible.`,
      },
      {
        name: 'resolution',
        type: 'select',
        options: {
          'bestvideo+bestaudio/best': 'Best',
          'bestvideo[height<=?2160]+bestaudio/best[height<=?2160]': '2160p',
          'bestvideo[height<=?1440]+bestaudio/best[height<=?1440]': '1440p',
          'bestvideo[height<=?1080]+bestaudio/best[height<=?1080]': '1080p',
          'bestvideo[height<=?720]+bestaudio/best[height<=?720]': '720p',
          'bestvideo[height<=?480]+bestaudio/best[height<=?480]': '480p',
          'bestvideo[height<=?360]+bestaudio/best[height<=?360]': '360p',
        },
        default: 'bestvideo[height<=?1080]+bestaudio/best[height<=?1080]',
        title: 'Resolution',
        description: 'Will try to download resolution closest to but not higher than selected value.',
        isHidden: (_, options) => options.mode === 'extractAudio',
      },
      {
        name: 'embedChapters',
        type: 'boolean',
        default: true,
        title: 'Embed chapters',
        description: `Embed chapters in final file when available. Forces output container to <code>mkv</code>.`,
      },
      {
        name: 'embedSubtitles',
        type: 'boolean',
        default: true,
        title: 'Embed subtitles',
        description: `Embed subtitles in final file when available. Forces output container to <code>mkv</code>.`,
      },
      {
        name: 'subLangs',
        type: 'string',
        default: 'all',
        title: 'Subtitle languages',
        description: `What languages to download. Example: <code>en.*,ja</code>. <a href="https://github.com/yt-dlp/yt-dlp#subtitle-options">Documentation</a>.`,
      },
      {
        name: 'liveChat',
        type: 'boolean',
        default: false,
        title: 'Live chat',
        description: `Download live chat data.`,
      },
      {
        name: 'outputTemplate',
        type: 'string',
        default: '%(title.0:100)S [%(id)S].%(ext)S',
        title: 'Output template',
        description:
          `<b>IMPORTANT:</b> using strings without uppercase <code>S</code> conversion type will result in filesystem incompatible paths.<br>
          <a href="https://github.com/yt-dlp/yt-dlp#output-template">Output template documentation</a>.
          `,
      },
      {
        name: 'cookiesFromBrowser',
        type: 'string',
        default: '',
        title: 'Cookies from browser',
        description:
          `Specify a browser cookie source identifier to extract cookies from for services that require auth this way. Syntax is <code>BROWSER[+KEYRING][:PROFILE][::CONTAINER]</code>. It can be as simple as <code>firefox</code>. For more search <code>cookies-from-browser</code> in <a href="https://github.com/yt-dlp/yt-dlp">documentation</a>.`,
      },
    ],
    operationPreparator: async (payload, utils) => {
      if (utils.modifiers === 'Ctrl' || payload.options.askDestination) {
        const result = await utils.showOpenDialog({
          title: `Destination directory`,
          properties: ['openDirectory', 'createDirectory', 'promptToCreate'],
        });

        // Cancel operation
        if (result.canceled) return false;

        const dirname = result.filePaths[0];

        if (typeof dirname === 'string') {
          payload.options.destination = dirname;
        } else {
          throw new Error(`No directory selected.`);
        }
      }

      return payload;
    },
    modifierDescriptions: {
      Ctrl: `ask for destination (overwrites the option)`,
    },
  });
};
