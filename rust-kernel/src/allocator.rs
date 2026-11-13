use core::alloc::{GlobalAlloc, Layout};
use core::arch::wasm32;
use core::cell::UnsafeCell;
use core::ptr::null_mut;

const PAGE_SIZE: usize = 65536;
const ALIGN: usize = 16;

#[repr(C)]
struct BlockHeader {
    size: usize,
    free: bool,
    next: *mut BlockHeader,
}

const HEADER_SIZE: usize = (core::mem::size_of::<BlockHeader>() + ALIGN - 1) & !(ALIGN - 1);

pub struct WasmAllocator {
    head: UnsafeCell<*mut BlockHeader>,
    total_allocated: UnsafeCell<usize>,
    total_capacity: UnsafeCell<usize>,
}

unsafe impl Sync for WasmAllocator {}

impl WasmAllocator {
    pub const fn new() -> Self {
        Self {
            head: UnsafeCell::new(null_mut()),
            total_allocated: UnsafeCell::new(0),
            total_capacity: UnsafeCell::new(0),
        }
    }

    pub fn stats(&self) -> (usize, usize) {
        unsafe { (*self.total_allocated.get(), *self.total_capacity.get()) }
    }

    unsafe fn grow_heap(&self, min_bytes: usize) -> *mut BlockHeader {
        let needed = min_bytes + HEADER_SIZE;
        let pages = ((needed + PAGE_SIZE - 1) / PAGE_SIZE).max(4);
        let prev_pages = wasm32::memory_grow(0, pages);
        if prev_pages == usize::MAX {
            return null_mut();
        }
        let base_addr = prev_pages * PAGE_SIZE;
        let cap_bytes = pages * PAGE_SIZE;
        *self.total_capacity.get() += cap_bytes;

        let block = base_addr as *mut BlockHeader;
        (*block).size = cap_bytes - HEADER_SIZE;
        (*block).free = true;
        (*block).next = null_mut();
        block
    }
}

unsafe impl GlobalAlloc for WasmAllocator {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        let size = (layout.size().max(16) + ALIGN - 1) & !(ALIGN - 1);

        let mut curr = *self.head.get();
        let mut prev: *mut BlockHeader = null_mut();

        while !curr.is_null() {
            if (*curr).free && (*curr).size >= size {
                // Split if remaining space is useful
                if (*curr).size >= size + HEADER_SIZE + 32 {
                    let next_addr = (curr as usize) + HEADER_SIZE + size;
                    let remainder = next_addr as *mut BlockHeader;
                    (*remainder).size = (*curr).size - size - HEADER_SIZE;
                    (*remainder).free = true;
                    (*remainder).next = (*curr).next;
                    (*curr).size = size;
                    (*curr).next = remainder;
                }
                (*curr).free = false;
                *self.total_allocated.get() += (*curr).size;
                return ((curr as usize) + HEADER_SIZE) as *mut u8;
            }
            prev = curr;
            curr = (*curr).next;
        }

        let new_block = self.grow_heap(size);
        if new_block.is_null() {
            return null_mut();
        }

        if prev.is_null() {
            *self.head.get() = new_block;
        } else {
            (*prev).next = new_block;
        }

        if (*new_block).size >= size + HEADER_SIZE + 32 {
            let next_addr = (new_block as usize) + HEADER_SIZE + size;
            let remainder = next_addr as *mut BlockHeader;
            (*remainder).size = (*new_block).size - size - HEADER_SIZE;
            (*remainder).free = true;
            (*remainder).next = null_mut();
            (*new_block).size = size;
            (*new_block).next = remainder;
        }

        (*new_block).free = false;
        *self.total_allocated.get() += (*new_block).size;
        ((new_block as usize) + HEADER_SIZE) as *mut u8
    }

    unsafe fn dealloc(&self, ptr: *mut u8, _layout: Layout) {
        if ptr.is_null() {
            return;
        }
        let block = ((ptr as usize) - HEADER_SIZE) as *mut BlockHeader;
        if !(*block).free {
            (*block).free = true;
            let alloc_ref = &mut *self.total_allocated.get();
            *alloc_ref = alloc_ref.saturating_sub((*block).size);
        }

        // Coalesce adjacent free blocks
        let mut curr = *self.head.get();
        while !curr.is_null() {
            let next = (*curr).next;
            if (*curr).free && !next.is_null() && (*next).free {
                let expected_next = (curr as usize) + HEADER_SIZE + (*curr).size;
                if next as usize == expected_next {
                    (*curr).size += HEADER_SIZE + (*next).size;
                    (*curr).next = (*next).next;
                    continue;
                }
            }
            curr = (*curr).next;
        }
    }
}
