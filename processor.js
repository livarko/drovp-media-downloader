const path = require('path');
const fs = require('fs').promises;
const {spawn} = require('child_process');
const {platformPaths} = require('platform-paths');
const {expandTemplateLiteral} = require('expand-template-literal');

const PROGRESS_REGEXP = /\[download\] *(?<percent>[\d\.]+)%/i;
const FILENAME_REGEXPS = [
  /\[download\] ?Destination: ?(?<filename>.*) *$/im,
  /\[download\] ?(?<filename>.*) ?has already been downloaded( and merged)? ?$/im,
  /\[(ffmpeg|Merger)\] ?Merging formats into "(?<filename>.*)" *$/im,
];
const MAIN_FILENAME_REGEXP = /echo "\[result_filepath\](?<filename>[^\"]+)/;

module.exports = async ({input, options}, {dependencies, progress, output, title}) => {
  const ytdlpPath = dependencies['yt-dlp'];
  const args = [
    '--encoding', 'utf8', '--no-warnings', '--netrc', '--ffmpeg-location', path.dirname(dependencies.ffmpeg),
    '--embed-chapters'
  ];
  const {url} = input;
  let hasError = false;

  let destination = options.destination.trim();
  if (destination) {
    const variables = {};
    const lowercaseDestination = destination.toLowerCase();
    const normalizedDestination = destination.replaceAll(path.sep, path.posix.sep);

    for (const name of Object.keys(platformPaths)) {
      if (lowercaseDestination.includes(name)) variables[name] = await platformPaths[name]();
    }

    try {
      destination = expandTemplateLiteral(normalizedDestination, variables);
    } catch (error) {
      output.error(`Destination template error: ${error.message}`);
      return;
    }
  } else {
    destination = await platformPaths.downloads();
  }

  switch (options.mode) {
    case 'extractAudio':
      args.push('-x');
      break;
    case 'download':
      args.push('-f', options.resolution);
      break;
    default:
      output.error(`Unknown mode "${options.mode}".`);
      return;
  }

  if (options.embedSubtitles) {
    args.push('--embed-subs');
    const langs = [...options.subLangs.split(','), options.liveChat ? null : '-live_chat'].filter(x => !!x).join(',');
    args.push('--sub-langs', langs);
  }
  if (!options.liveChat) args.push('--compat-options', 'no-live-chat');
  args.push('-o', options.outputTemplate ? `${options.outputTemplate}`.trim() : `%(title.0:100)S [%(id)S].%(ext)S`);
  if (options.cookiesFromBrowser.trim().length > 0) {
    args.push('--cookies-from-browser', options.cookiesFromBrowser.trim())
  }

  // Report final path
  // This turned out to produce incorrect outputs, as the echoed string had
  // characters that can't be used in windows filesystem, but the actual file
  // didn't even use them.
  // --restrict-filenames fixes this, but now the filenames are ugly as it
  // replaces spaces with underscores. Why? It's not 1995... But at least it
  // works now.
  args.push('--exec', 'echo "[result_filepath]%(filepath)s"');

  args.push(url);

  console.log(`url:`, url);
  console.log(`destination:`, destination);
  console.log(`mode:`, options.mode);
  console.log(`yt-dlp:`, ytdlpPath);
  console.log(`args:`, args.join(' '));

  await fs.mkdir(destination, {recursive: true});
  process.chdir(destination);

  return new Promise((resolve) => {
    let filePath;
    const process = spawn(ytdlpPath, args, {cwd: destination});

    process.stdout.on('data', (buffer) => {
      const data = buffer.toString();

      // Extract progress
      const percent = PROGRESS_REGEXP.exec(data)?.groups?.percent;
      if (percent) {
        if (!progress.total) progress.total = 1;
        progress.completed = (parseFloat(percent) || 0) / 100;
        return;
      }

      // Only log if it's not progress
      console.log(data);

      // Extract file name from all possible matches
      let filenameMatch = MAIN_FILENAME_REGEXP.exec(data);

      if (!filenameMatch) {
        for (const regexp of FILENAME_REGEXPS) {
          filenameMatch = regexp.exec(data);
          if (filenameMatch) break;
        }
      }

      const filenameString = filenameMatch?.groups?.filename.trim();
      if (filenameString) {
        filePath = path.resolve(destination, filenameString);
        console.log('extracted path:', filePath);
        title(path.basename(filenameString));
        return;
      }
    });

    process.stderr.on('data', (buffer) => {
      hasError = true;
      const data = buffer.toString();
      console.log(data);
      output.error(data);
    });

    process.on('close', async (code) => {
      if (code != 0) console.log(`child process exited with code ${code}`);
      if (filePath) {
        try {
          await fs.access(filePath);
          output.file(filePath);
        } catch {
          output.warning(`Extracted file path doesn't exist. This might just be an issue of file path containing weird characters, unless there were other errors, the file might still be in your destination.`);
        }
      } else if (!hasError) {
        output.warning(
          `Couldn't extract file name.\nThere were no other errors, so your file is probably in your destination folder.`
        );
      }
      resolve();
    });
  });
};
