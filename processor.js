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
const MAIN_FILENAME_REGEXP = /\[result_filepath\](?<filename>[^\"]+)/;

module.exports = async ({input, options}, {dependencies, progress, output, title}) => {
  const ytdlpPath = dependencies['yt-dlp'];
  const args = [
    '--encoding', 'utf8', '--no-warnings', '--netrc', '--restrict-filenames',
    '--ffmpeg-location', path.dirname(dependencies.ffmpeg)
  ];
  let {destination, mode, resolution, outputTemplate} = options;
  const {url} = input;
  let hasError = false;

  destination = destination.trim();
  if (destination) {
    const variables = {};
    const lowercaseDestination = destination.toLowerCase();

    for (const name of Object.keys(platformPaths)) {
      if (lowercaseDestination.includes(name)) variables[name] = await platformPaths[name]();
    }

    try {
      destination = expandTemplateLiteral(destination, variables);
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
      args.push('-f', resolution);
      break;
    default:
      output.error(`Unknown mode "${options.mode}".`);
      return;
  }

  outputTemplate = outputTemplate ? `${outputTemplate}`.trim() : false;
  if (outputTemplate) args.push('-o', outputTemplate);

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
  console.log(`mode:`, mode);
  console.log(`yt-dlp:`, ytdlpPath);
  console.log(`args:`, args.join(' '));

  await fs.mkdir(destination, {recursive: true});
  process.chdir(destination);

  return new Promise((resolve) => {
    let fileName;
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
        fileName = filenameString;
        console.log('extracted path:', fileName);
        title(path.basename(fileName));
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
      if (fileName) {
        try {
          await fs.access(fileName);
          output.file(fileName);
        } catch {
          output.warning(`Extracted file path doesn't exist. There were no errors, so the file should be where it's supposed to be, the plugin was just unable to extract the result filename from the yt-dlp output, because yt-dlp output sux and is very hard to parse by machines :(.`);
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
