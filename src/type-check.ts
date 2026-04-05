// Compile-time check: GDriveFs must fully satisfy IFileSystem
import type { IFileSystem } from "just-bash";
import type { GDriveFs } from "./gdrive-fs.js";

const _check: IFileSystem = {} as GDriveFs;
void _check;
