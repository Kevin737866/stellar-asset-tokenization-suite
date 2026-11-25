/**
 * Regression tests for CLI help text and command examples.
 */

jest.mock('../custody', () => ({
  CustodyClient: jest.fn(),
}));

import {
  COMMAND_HELP_EXAMPLES,
  SUPPORTED_COMMANDS,
  getHelpText,
  printCreatePoolHelp,
  printGenerateTypesHelp,
  printHelp,
  printLiquidateHelp,
  runCli,
} from '../cli';

describe('CLI command help examples', () => {
  it('defines non-empty examples for every supported command', () => {
    for (const command of SUPPORTED_COMMANDS) {
      const examples = COMMAND_HELP_EXAMPLES[command];
      expect(Array.isArray(examples)).toBe(true);
      expect(examples.length).toBeGreaterThan(0);
      for (const example of examples) {
        expect(example).toContain(command);
      }
    }
  });

  it('includes an Examples section covering every supported operation in top-level help', () => {
    const help = getHelpText();
    expect(help).toContain('Examples:');
    expect(help).toContain('--interactive');
    for (const command of SUPPORTED_COMMANDS) {
      expect(help).toContain(COMMAND_HELP_EXAMPLES[command][0]);
    }
  });

  it.each(SUPPORTED_COMMANDS)(
    'includes command-specific Examples section for %s',
    (command) => {
      const help = getHelpText(command);
      expect(help).toContain('Examples:');
      for (const example of COMMAND_HELP_EXAMPLES[command]) {
        expect(help).toContain(example);
      }
    }
  );

  it('throws an explicit error for unknown commands in getHelpText()', () => {
    expect(() => getHelpText('non-existent-command')).toThrow(
      /Unknown command: "non-existent-command"/
    );
  });

  it('prints help text via each print*Help helper', () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      printHelp();
      expect(logSpy).toHaveBeenLastCalledWith(getHelpText());

      printCreatePoolHelp();
      expect(logSpy).toHaveBeenLastCalledWith(getHelpText('create-pool'));

      printLiquidateHelp();
      expect(logSpy).toHaveBeenLastCalledWith(getHelpText('liquidate'));

      printGenerateTypesHelp();
      expect(logSpy).toHaveBeenLastCalledWith(getHelpText('generate-types'));
    } finally {
      logSpy.mockRestore();
    }
  });
});

describe('runCli() help routing', () => {
  const originalArgv = process.argv;
  let logSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;
  let exitSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    exitSpy = jest.spyOn(process, 'exit').mockImplementation((code?: string | number | null) => {
      throw new Error(`EXIT:${code}`);
    });
  });

  afterEach(() => {
    process.argv = originalArgv;
    logSpy.mockRestore();
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('prints top-level help with examples for --help', async () => {
    process.argv = ['node', 'dist/cli.js', '--help'];
    await expect(runCli()).rejects.toThrow('EXIT:0');
    expect(logSpy).toHaveBeenCalledWith(getHelpText());
  });

  it.each([
    ['create-pool', '--help'],
    ['liquidate', '-h'],
    ['generate-types', '--help'],
  ] as const)('routes %s %s to command-specific help with examples', async (command, flag) => {
    process.argv = ['node', 'dist/cli.js', command, flag];
    await expect(runCli()).rejects.toThrow();
    expect(exitSpy).toHaveBeenNthCalledWith(1, 0);
    expect(logSpy).toHaveBeenCalledWith(getHelpText(command));
  });

  it('exits with code 1 and prints help for an unknown command', async () => {
    process.argv = ['node', 'dist/cli.js', 'invalid-op'];
    await expect(runCli()).rejects.toThrow();
    expect(exitSpy).toHaveBeenNthCalledWith(1, 1);
    expect(errorSpy).toHaveBeenCalledWith('Unknown command: "invalid-op".');
    expect(logSpy).toHaveBeenCalledWith(getHelpText());
  });
});
