import { spawn, SpawnOptions } from 'child_process'
import { readdir } from 'fs/promises'

export async function runCommand(command: string, args: string[] = [], options: SpawnOptions = {}): Promise<string> {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            ...options,
            stdio: ['inherit', 'pipe', 'pipe']
        })

        let stdout = ''

        child.stdout?.on('data', (data: Buffer) => {
            const text = data.toString()
            stdout += text
            process.stdout.write(text)
        })

        child.stderr?.on('data', (data: Buffer) => {
            process.stderr.write(data)
        })

        child.on('error', reject)

        child.on('close', code => {
            if (code === 0) {
                resolve(stdout)
            } else {
                reject(new Error(`${command} exited with code ${code}`))
            }
        })
    })
}

export async function walkDir(dir: string, prefix = ''): Promise<string[]> {
    let results: string[] = []
    const list = await readdir(dir, { withFileTypes: true })
    for (const file of list) {
        const relativePath = prefix ? `${prefix}/${file.name}` : file.name
        if (file.isDirectory()) {
            const res = await walkDir(`${dir}/${file.name}`, relativePath)
            results = results.concat(res)
        } else {
            results.push(relativePath)
        }
    }
    return results
}
