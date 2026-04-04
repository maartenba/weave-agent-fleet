import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Extract the filename from a file path (the last segment after the last "/"). */
export function getFileName(filePath: string): string {
  return filePath.split("/").pop() ?? filePath;
}
