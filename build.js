const fs = require('fs');
const path = require('path');
const JavaScriptObfuscator = require('javascript-obfuscator');

const rootDir = __dirname;
const distDir = path.join(rootDir, 'dist');

// Configuration for JavaScript Obfuscator
const obfuscatorConfig = {
    compact: true,
    controlFlowFlattening: true,
    controlFlowFlatteningThreshold: 0.75,
    deadCodeInjection: false, // Turned off to prevent excessive bundle bloat
    debugProtection: false,
    debugProtectionInterval: 0,
    disableConsoleOutput: false,
    identifierNamesGenerator: 'hexadecimal',
    log: false,
    numbersToExpressions: true,
    renameGlobals: false, // CRITICAL: Preserve global variables and function names loaded from script tags
    selfDefending: false,
    simplify: true,
    splitStrings: true,
    splitStringsChunkLength: 10,
    stringArray: true,
    stringArrayCallsTransform: true,
    stringArrayCallsTransformThreshold: 0.5,
    stringArrayEncoding: ['base64'],
    stringArrayIndexesType: ['hexadecimal-number'],
    stringArrayThreshold: 0.75,
    sourceMap: false // CRITICAL: Enforce no source maps for production output
};

// Folders and files to exclude from the root copy
const excludePaths = [
    'node_modules',
    '.git',
    '.firebase',
    'dist',
    'supabase',
    'package.json',
    'package-lock.json',
    'build.js',
    '.firebaserc',
    'firebase.json',
    'firestore.rules',
    'ธีม.zip'
];

function deleteFolderRecursive(folderPath) {
    if (fs.existsSync(folderPath)) {
        fs.readdirSync(folderPath).forEach((file) => {
            const curPath = path.join(folderPath, file);
            if (fs.lstatSync(curPath).isDirectory()) {
                deleteFolderRecursive(curPath);
            } else {
                fs.unlinkSync(curPath);
            }
        });
        fs.rmdirSync(folderPath);
    }
}

function copyRecursiveSync(src, dest) {
    const exists = fs.existsSync(src);
    const stats = exists && fs.statSync(src);
    const isDirectory = exists && stats.isDirectory();
    
    // Check if the current file/directory is excluded
    const relativePath = path.relative(rootDir, src);
    if (excludePaths.includes(relativePath) || excludePaths.includes(path.basename(src))) {
        return;
    }

    if (isDirectory) {
        if (!fs.existsSync(dest)) {
            fs.mkdirSync(dest, { recursive: true });
        }
        fs.readdirSync(src).forEach((childItemName) => {
            copyRecursiveSync(path.join(src, childItemName), path.join(dest, childItemName));
        });
    } else {
        // Only copy files that are not javascript source files inside 'js/' directly,
        // because those will be obfuscated separately.
        const inJsFolder = relativePath.startsWith('js' + path.sep) || relativePath === 'js';
        if (inJsFolder && path.extname(src) === '.js') {
            return;
        }
        fs.copyFileSync(src, dest);
    }
}

async function obfuscateJsFiles(srcDir, destDir) {
    if (!fs.existsSync(srcDir)) return;
    
    if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
    }

    const items = fs.readdirSync(srcDir);
    for (const item of items) {
        const srcItemPath = path.join(srcDir, item);
        const destItemPath = path.join(destDir, item);
        const stats = fs.statSync(srcItemPath);

        if (stats.isDirectory()) {
            await obfuscateJsFiles(srcItemPath, destItemPath);
        } else if (path.extname(srcItemPath) === '.js') {
            console.log(`Obfuscating: ${path.relative(rootDir, srcItemPath)}`);
            const fileContent = fs.readFileSync(srcItemPath, 'utf8');
            try {
                const obfuscationResult = JavaScriptObfuscator.obfuscate(fileContent, obfuscatorConfig);
                fs.writeFileSync(destItemPath, obfuscationResult.getObfuscatedCode(), 'utf8');
            } catch (err) {
                console.error(`Failed to obfuscate ${srcItemPath}:`, err);
                // Fallback to copying standard file if obfuscation fails (though it shouldn't)
                fs.copyFileSync(srcItemPath, destItemPath);
            }
        }
    }
}

async function build() {
    console.log('Cleaning up old dist folder...');
    deleteFolderRecursive(distDir);
    fs.mkdirSync(distDir, { recursive: true });

    console.log('Copying static assets and files...');
    
    // Copy school logo (Prioritize user custom logo from Downloads, fallback to generated one)
    const userCustomLogo = 'C:\\Users\\Ai_Nb\\Downloads\\Logo.png';
    const artifactLogo = 'C:\\Users\\Ai_Nb\\.gemini\\antigravity\\brain\\3e20a344-3275-41c7-934c-d78cf0dcca6b\\school_logo_round_1782221906804.png';
    const localLogo = path.join(rootDir, 'school_logo_round.png');
    
    if (fs.existsSync(userCustomLogo)) {
        try {
            fs.copyFileSync(userCustomLogo, localLogo);
            console.log('User custom Logo.png copied from Downloads successfully.');
        } catch (copyErr) {
            console.warn('Failed to copy user custom Logo.png:', copyErr.message);
        }
    } else if (fs.existsSync(artifactLogo)) {
        try {
            fs.copyFileSync(artifactLogo, localLogo);
            console.log('Circular school logo copied from artifacts successfully.');
        } catch (copyErr) {
            console.warn('Failed to copy circular school logo from artifacts:', copyErr.message);
        }
    }

    copyRecursiveSync(rootDir, distDir);

    console.log('Obfuscating JavaScript files...');
    await obfuscateJsFiles(path.join(rootDir, 'js'), path.join(distDir, 'js'));

    console.log('\nBuild completed successfully! Production bundle generated in /dist');
}

build().catch(err => {
    console.error('Build process failed:', err);
    process.exit(1);
});
