import { describe, expect, it } from 'vitest';

import { classifyChangedFiles, classifyFile } from './shield-classify.js';

// ─── classifyFile ───────────────────────────────────

describe('classifyFile', () => {
  // CODE: TypeScript / JavaScript
  it.each([
    'src/index.ts',
    'src/app.tsx',
    'lib/util.js',
    'lib/component.jsx',
    'scripts/build.mjs',
    'scripts/config.cjs',
  ])('classifies %s as CODE', (filePath) => {
    expect(classifyFile(filePath)).toBe('CODE');
  });

  // CODE: Python, Rust, Go
  it.each(['main.py', 'lib.rs', 'server.go'])('classifies %s as CODE', (filePath) => {
    expect(classifyFile(filePath)).toBe('CODE');
  });

  // CODE: Shell scripts
  it.each(['deploy.sh', 'init.bash', 'setup.zsh', 'build.ps1'])(
    'classifies %s as CODE',
    (filePath) => {
      expect(classifyFile(filePath)).toBe('CODE');
    },
  );

  // CODE: Other languages
  it.each([
    'App.java',
    'Main.kt',
    'Build.scala',
    'main.c',
    'engine.cpp',
    'parser.cc',
    'header.h',
    'types.hpp',
    'Program.cs',
    'app.rb',
    'index.php',
    'App.swift',
    'script.lua',
    'analysis.r',
    'stats.R',
    'query.sql',
    'main.zig',
    'app.nim',
    'server.ex',
    'test_helper.exs',
    'gen_server.erl',
    'Types.hs',
    'parser.ml',
    'App.vue',
    'Page.svelte',
  ])('classifies %s as CODE', (filePath) => {
    expect(classifyFile(filePath)).toBe('CODE');
  });

  // CODE: Known filenames without extension
  it.each(['Dockerfile', 'Makefile', 'Rakefile', 'Gemfile', 'Justfile'])(
    'classifies %s as CODE',
    (filePath) => {
      expect(classifyFile(filePath)).toBe('CODE');
    },
  );

  // CODE: Known filenames in subdirectories
  it('classifies nested Dockerfile as CODE', () => {
    expect(classifyFile('services/api/Dockerfile')).toBe('CODE');
  });

  // NON_CODE: Markdown / docs
  it.each(['README.md', 'docs/guide.mdx', 'notes.txt', 'docs/index.rst'])(
    'classifies %s as NON_CODE',
    (filePath) => {
      expect(classifyFile(filePath)).toBe('NON_CODE');
    },
  );

  // NON_CODE: Config / data files
  it.each([
    'config.yml',
    'config.yaml',
    'package.json',
    'pyproject.toml',
    'manifest.xml',
    'styles.css',
    'theme.scss',
    'vars.less',
  ])('classifies %s as NON_CODE', (filePath) => {
    expect(classifyFile(filePath)).toBe('NON_CODE');
  });

  // NON_CODE: Assets
  it.each([
    'logo.svg',
    'photo.png',
    'banner.jpg',
    'icon.jpeg',
    'anim.gif',
    'favicon.ico',
    'hero.webp',
    'font.woff',
    'font.woff2',
    'font.ttf',
    'font.eot',
  ])('classifies %s as NON_CODE', (filePath) => {
    expect(classifyFile(filePath)).toBe('NON_CODE');
  });

  // NON_CODE: Lock files and build artifacts
  it.each([
    'pnpm-lock.yaml',
    'package-lock.json',
    'bun.lockb',
    'yarn.lock',
    'dist/index.js.map',
    'tsconfig.tsbuildinfo',
  ])('classifies %s as NON_CODE', (filePath) => {
    expect(classifyFile(filePath)).toBe('NON_CODE');
  });

  // NON_CODE: Known filenames
  it.each([
    'LICENSE',
    'CHANGELOG',
    'CHANGELOG.md',
    '.gitignore',
    '.gitattributes',
    '.editorconfig',
    '.prettierrc',
    '.eslintignore',
  ])('classifies %s as NON_CODE', (filePath) => {
    expect(classifyFile(filePath)).toBe('NON_CODE');
  });

  // NON_CODE: .d.ts.map files
  it('classifies .d.ts.map files as NON_CODE', () => {
    expect(classifyFile('dist/index.d.ts.map')).toBe('NON_CODE');
  });

  // Fail-closed: unknown extensions default to CODE
  it('classifies unknown extension as CODE (fail-closed)', () => {
    expect(classifyFile('data.xyz')).toBe('CODE');
  });

  it('classifies another unknown extension as CODE', () => {
    expect(classifyFile('report.foobar')).toBe('CODE');
  });

  // No extension, not a known filename → CODE
  it('classifies extensionless unknown file as CODE', () => {
    expect(classifyFile('some-script')).toBe('CODE');
  });
});

// ─── classifyChangedFiles ───────────────────────────

describe('classifyChangedFiles', () => {
  it('returns allCode: true for all code files', () => {
    const result = classifyChangedFiles(['src/index.ts', 'lib/util.js', 'main.py']);
    expect(result.allCode).toBe(true);
    expect(result.allNonCode).toBe(false);
    expect(result.codeFiles).toEqual(['src/index.ts', 'lib/util.js', 'main.py']);
    expect(result.nonCodeFiles).toEqual([]);
  });

  it('returns allNonCode: true for all non-code files', () => {
    const result = classifyChangedFiles(['README.md', 'config.yaml', 'logo.png']);
    expect(result.allNonCode).toBe(true);
    expect(result.allCode).toBe(false);
    expect(result.codeFiles).toEqual([]);
    expect(result.nonCodeFiles).toEqual(['README.md', 'config.yaml', 'logo.png']);
  });

  it('handles mixed code and non-code files', () => {
    const result = classifyChangedFiles(['src/index.ts', 'README.md', 'main.py', 'config.yaml']);
    expect(result.allCode).toBe(false);
    expect(result.allNonCode).toBe(false);
    expect(result.codeFiles).toEqual(['src/index.ts', 'main.py']);
    expect(result.nonCodeFiles).toEqual(['README.md', 'config.yaml']);
  });

  it('returns allNonCode: true for empty array', () => {
    const result = classifyChangedFiles([]);
    expect(result.allNonCode).toBe(true);
    expect(result.allCode).toBe(false);
    expect(result.codeFiles).toEqual([]);
    expect(result.nonCodeFiles).toEqual([]);
  });

  it('handles single code file', () => {
    const result = classifyChangedFiles(['src/app.tsx']);
    expect(result.allCode).toBe(true);
    expect(result.allNonCode).toBe(false);
    expect(result.codeFiles).toEqual(['src/app.tsx']);
    expect(result.nonCodeFiles).toEqual([]);
  });

  it('handles single non-code file', () => {
    const result = classifyChangedFiles(['package.json']);
    expect(result.allNonCode).toBe(true);
    expect(result.allCode).toBe(false);
    expect(result.codeFiles).toEqual([]);
    expect(result.nonCodeFiles).toEqual(['package.json']);
  });
});
