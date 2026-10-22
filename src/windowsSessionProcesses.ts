import { execFile } from "node:child_process";
import * as path from "node:path";

export interface WindowsSessionProcess {
    readonly id: number;
    readonly parentId: number;
    readonly name: string;
    readonly started: number;
}

export interface WindowsSessionProcesses {
    readonly owners: readonly { id: number; started: number }[];
    readonly processes: readonly WindowsSessionProcess[];
}

// Paths travel as environment data, never interpolated into PowerShell source.
// Only query Restart Manager; never request process shutdown or restart.
const INSPECT_SESSION = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using FILETIME = System.Runtime.InteropServices.ComTypes.FILETIME;
using System.Text;
public static class SessionFileOwners {
    [StructLayout(LayoutKind.Sequential)]
    public struct UniqueProcess { public uint Id; public FILETIME Started; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct ProcessInfo {
        public UniqueProcess Process;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)] public string AppName;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)] public string ServiceName;
        public uint AppType, Status, SessionId;
        [MarshalAs(UnmanagedType.Bool)] public bool Restartable;
    }
    [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)]
    static extern int RmStartSession(out uint handle, uint flags, StringBuilder key);
    [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)]
    static extern int RmRegisterResources(uint handle, uint count, string[] files, uint appCount, IntPtr apps, uint serviceCount, IntPtr services);
    [DllImport("rstrtmgr.dll")]
    static extern int RmGetList(uint handle, out uint needed, ref uint count, [In, Out] ProcessInfo[] apps, ref uint reasons);
    [DllImport("rstrtmgr.dll")]
    static extern int RmEndSession(uint handle);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern IntPtr OpenProcess(uint access, bool inherit, uint processId);
    [DllImport("kernel32.dll")]
    static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll")]
    static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll")]
    static extern bool DuplicateHandle(IntPtr source, IntPtr value, IntPtr target, out IntPtr copy, uint access, bool inherit, uint options);
    [DllImport("kernel32.dll")]
    static extern uint GetFileType(IntPtr handle);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    static extern uint GetFinalPathNameByHandle(IntPtr handle, StringBuilder name, uint length, uint flags);
    [DllImport("ntdll.dll")]
    static extern int NtQueryInformationProcess(IntPtr process, int infoClass, IntPtr info, int length, out int needed);
    [StructLayout(LayoutKind.Sequential)]
    struct HandleEntry {
        public IntPtr Handle, HandleCount, PointerCount;
        public uint Access, Type, Attributes, Reserved;
    }
    static string NormalPath(string value) {
        if (value.StartsWith(@"\\?\UNC\", StringComparison.OrdinalIgnoreCase)) return @"\\" + value.Substring(8);
        return value.StartsWith(@"\\?\", StringComparison.Ordinal) ? value.Substring(4) : value;
    }
    // Restart Manager also lists readers. Verify a writable handle before linking.
    public static bool WritesFile(uint processId, string file) {
        IntPtr process = OpenProcess(0x440, false, processId);
        if (process == IntPtr.Zero) return false;
        IntPtr buffer = IntPtr.Zero;
        try {
            int size = 65536, needed;
            for (int attempt = 0; attempt < 4; attempt++) {
                buffer = Marshal.AllocHGlobal(size);
                int status = NtQueryInformationProcess(process, 51, buffer, size, out needed);
                if (status == 0) {
                    long count = Marshal.ReadIntPtr(buffer).ToInt64();
                    int entrySize = Marshal.SizeOf(typeof(HandleEntry));
                    if (count < 0 || count > 8192 || count > (size - 2 * IntPtr.Size) / entrySize) return false;
                    for (int i = 0; i < count; i++) {
                        var entry = (HandleEntry)Marshal.PtrToStructure(IntPtr.Add(buffer, 2 * IntPtr.Size + i * entrySize), typeof(HandleEntry));
                        if ((entry.Access & 6) == 0) continue;
                        IntPtr copy;
                        if (!DuplicateHandle(process, entry.Handle, GetCurrentProcess(), out copy, 0, false, 2)) continue;
                        try {
                            if (GetFileType(copy) != 1) continue;
                            var name = new StringBuilder(32768);
                            uint length = GetFinalPathNameByHandle(copy, name, (uint)name.Capacity, 0);
                            if (length > 0 && length < name.Capacity && String.Equals(NormalPath(name.ToString()), NormalPath(file), StringComparison.OrdinalIgnoreCase)) return true;
                        } finally { CloseHandle(copy); }
                    }
                    return false;
                }
                Marshal.FreeHGlobal(buffer);
                buffer = IntPtr.Zero;
                if (needed <= size || needed > 1048576) return false;
                size = needed;
            }
        } catch { return false; }
        finally {
            if (buffer != IntPtr.Zero) Marshal.FreeHGlobal(buffer);
            CloseHandle(process);
        }
        return false;
    }
    public static UniqueProcess[] Find(string file) {
        uint handle;
        int result = RmStartSession(out handle, 0, new StringBuilder(33));
        if (result != 0) throw new Win32Exception(result);
        try {
            result = RmRegisterResources(handle, 1, new[] { file }, 0, IntPtr.Zero, 0, IntPtr.Zero);
            if (result != 0) throw new Win32Exception(result);
            uint needed = 0, count = 0, reasons = 0;
            ProcessInfo[] apps = null;
            for (int attempt = 0; attempt < 4; attempt++) {
                result = RmGetList(handle, out needed, ref count, apps, ref reasons);
                if (result == 0) {
                    var owners = new UniqueProcess[count];
                    for (int i = 0; i < count; i++) owners[i] = apps[i].Process;
                    return owners;
                }
                if (result != 234 || needed > 4096) throw new Win32Exception(result);
                count = needed;
                apps = new ProcessInfo[count];
            }
            throw new Win32Exception(result);
        } finally { RmEndSession(handle); }
    }
    public static long Started(UniqueProcess process) {
        return (((long)(uint)process.Started.dwHighDateTime << 32) | (uint)process.Started.dwLowDateTime) / 10000;
    }
}
'@
$owners = @([SessionFileOwners]::Find($env:MULTI_HARNESS_SESSION_FILE) | ForEach-Object {
    if ([SessionFileOwners]::WritesFile($_.Id, $env:MULTI_HARNESS_SESSION_FILE)) {
        @{ id = [int]$_.Id; started = [SessionFileOwners]::Started($_) }
    }
})
$processes = @(Get-CimInstance Win32_Process | ForEach-Object {
    if ($null -ne $_.CreationDate) {
        @{ id = [int]$_.ProcessId; parentId = [int]$_.ParentProcessId; name = $_.Name; started = [long][Math]::Floor($_.CreationDate.ToFileTimeUtc() / 10000) }
    }
})
@{ owners = $owners; processes = $processes } | ConvertTo-Json -Depth 4 -Compress
`;

/** Inspect one known session file once, shared by all terminals in the window. */
export async function inspectWindowsSessionProcesses(file: string): Promise<WindowsSessionProcesses | undefined> {
    if (process.platform !== "win32") return undefined;
    const executable = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    try {
        const stdout = await new Promise<string>((resolve, reject) => {
            execFile(executable, ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(INSPECT_SESSION, "utf16le").toString("base64")], {
                env: { ...process.env, MULTI_HARNESS_SESSION_FILE: file },
                windowsHide: true, timeout: 15_000, maxBuffer: 2 * 1024 * 1024, encoding: "utf8",
            }, (error, output, stderr) => error ? reject(new Error(`Windows session inspection failed (${error.code}): ${stderr}`)) : resolve(output));
        });
        const result = JSON.parse(stdout.replace(/^\uFEFF/, "")) as WindowsSessionProcesses;
        return Array.isArray(result.owners) && Array.isArray(result.processes) ? result : undefined;
    } catch {
        // Restricted PowerShell/CIM must not prevent history deletion.
        return undefined;
    }
}

/** undefined means discovery failed; false means a live Codex has another file. */
export function windowsCodexUsesSession(terminalPid: number, snapshot: WindowsSessionProcesses): boolean | undefined {
    if (!Number.isSafeInteger(terminalPid) || terminalPid <= 0) return undefined;
    const processes = new Map(snapshot.processes.map((process) => [process.id, process]));
    const pending = [terminalPid];
    const visited = new Set<number>();
    let found = false;
    while (pending.length && visited.size < 64) {
        const pid = pending.shift()!;
        if (visited.has(pid)) continue;
        visited.add(pid);
        const current = processes.get(pid);
        if (!current) continue;
        if (/^codex(?:-|\.exe$|$)/i.test(current.name)) {
            found = true;
            if (snapshot.owners.some((owner) => owner.id === pid && Math.abs(owner.started - current.started) <= 1)) return true;
            // Tool-launched Codex children represent separate conversations.
            continue;
        }
        for (const child of snapshot.processes) {
            if (child.parentId === pid && child.started >= current.started && pending.length < 64) pending.push(child.id);
        }
    }
    return found ? false : undefined;
}
