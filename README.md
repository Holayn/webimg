# webimg

A tool to convert and resize images and videos for web use.

## Usage

```bash
npm run start -- --input <input> --output <output>
```

Or

```bash
npm run start -- --config <config>
```

### Options

| Option | Description |
| --- | --- |
| `--input <input>` | Absolute path to the directory holding files to process |
| `--output <output>` | Absolute path to the directory holding processed files |
| `--config <config>` | Path to the config file |
| `--relocateConverted <relocateConverted>` | Absolute path to the directory for relocating converted files to |
| `--exclude <exclude>` | Array of relative paths of files to exclude |
| `--sizes <sizes>` | Sizes to resize images to |
| `--dryRun` | Run in dry run mode |