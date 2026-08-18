import { invoke } from '@tauri-apps/api/core'

interface FsEntry { name: string; is_dir: boolean; size: number }

export const fsApi = {
  read: (path: string) => invoke<number[]>('fs_read', { path }),
  write: (path: string, content: number[]) =>
    invoke<void>('fs_write', { path, content }),
  list: (dir: string) => invoke<FsEntry[]>('fs_list', { dir }),
  exists: (path: string) => invoke<boolean>('fs_exists', { path }),
}
