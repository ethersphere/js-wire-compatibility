import { Bee, MantarayNode, NULL_STAMP } from '@ethersphere/bee-js'
import { Arrays, Binary, Dates, System, Types } from 'cafe-utility'
import { existsSync } from 'fs'
import { readFile, writeFile } from 'fs/promises'
import { pathsToVerify } from './dataset'
import { runCommand, walkDir } from './utility'

main()

async function main() {
    // Clone Swarm blog
    if (!existsSync('./tmp')) {
        await runCommand('git', [
            'clone',
            'https://github.com/ethersphere/ethswarm-blog-hugo.git',
            './tmp',
            '--depth',
            '1'
        ])
    }
    // Build static files with Hugo
    await runCommand('hugo', ['-D', '--gc'], { cwd: './tmp' })
    // Upload
    const swarmCliHash = await uploadWithSwarmCli()
    const swarmFsHash = await uploadWithSwarmFs()
    const beeJsHash = await uploadWithBeeJs()
    // Wait for propagation
    await System.sleepMillis(Dates.minutes(1))
    // Verify payloads
    console.log({ swarmCliHash, swarmFsHash, beeJsHash })
    await verify(swarmCliHash, swarmFsHash, beeJsHash)
}

async function verify(swarmCliHash: `0x${string}`, swarmFsHash: `0x${string}`, beeJsHash: `0x${string}`) {
    for (const path of pathsToVerify) {
        console.log(`Verifying payload for ${path}...`)
        const cliPayload = await getPayload(swarmCliHash, path)
        const fsPayload = await getPayload(swarmFsHash, path)
        const beeJsPayload = await getPayload(beeJsHash, path)
        if (!Binary.equals(cliPayload, fsPayload) || !Binary.equals(cliPayload, beeJsPayload)) {
            await writeFile(`mismatch__swarm-cli.bin`, cliPayload)
            await writeFile(`mismatch__swarm-fs.bin`, fsPayload)
            await writeFile(`mismatch__bee-js.bin`, beeJsPayload)
            throw new Error(`Payload mismatch for ${path}`)
        }
    }
}

async function uploadWithSwarmCli(): Promise<`0x${string}`> {
    const output = await runCommand(
        'swarm-cli',
        ['upload', '.', '--stamp', NULL_STAMP.toHex(), '--bee-api-url', 'https://api.gateway.ethswarm.org'],
        { cwd: './tmp/public' }
    )
    const match = output.match(/^Swarm hash:\s+([a-f0-9]+)/m)
    if (!match) {
        throw new Error('Failed to find Swarm hash in output.')
    }
    const hash = match[1]
    return Types.asHexString(hash, { byteLength: 32 })
}

async function uploadWithSwarmFs(): Promise<`0x${string}`> {
    const output = await runCommand('swarm-fs', ['upload', '.'], { cwd: './tmp/public' })
    const lines = output.split('\n').filter(x => x)
    return Types.asHexString(Arrays.last(lines), { byteLength: 32 })
}

async function uploadWithBeeJs(): Promise<`0x${string}`> {
    const bee = new Bee('https://api.gateway.ethswarm.org')
    const files = await walkDir('./tmp/public')
    let processed = 0
    // path => hash
    const map: Map<string, string> = new Map()
    for (const file of files) {
        console.log(`Uploading ${file}...`)
        const buffer = await readFile(`./tmp/public/${file}`)
        if (buffer.length === 0) {
            continue
        }
        const result = await bee.uploadData(NULL_STAMP, buffer)
        map.set(file, result.reference.toHex())
        console.log(`Processed ${++processed} of ${files.length} files...`)
    }
    processed = 0
    const manifest = new MantarayNode()
    for (const [path, hash] of map.entries()) {
        manifest.addFork(path, hash)
        console.log(`Processed ${++processed} of ${files.length} fork...`)
    }
    const result = await manifest.saveRecursively(bee, NULL_STAMP)
    return Types.asHexString(result.reference.toHex(), { byteLength: 32 })
}

async function getPayload(hash: string, path: string): Promise<Uint8Array> {
    hash = hash.replace(/^0x/, '')
    const response = await fetch(`https://bzz.limo/bzz/${hash}/${path}`)
    if (!response.ok) {
        throw new Error(`Failed to fetch ${hash}/${path}: ${response.status} ${response.statusText}`)
    }
    const arrayBuffer = await response.arrayBuffer()
    return new Uint8Array(arrayBuffer)
}
