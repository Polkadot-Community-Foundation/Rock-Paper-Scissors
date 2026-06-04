#![cfg_attr(not(feature = "abi-gen"), no_main, no_std)]

#[pvm_contract_sdk::contract(allocator = "pico", allocator_size = 4096)]
mod leaderboard {
    use alloc::string::String;
    use pvm_contract_sdk::{Address, HostApi, Lazy, Mapping};

    pvm_contract_sdk::sol_revert_enum! {
        pub enum Error {
            AlreadyRegistered(AlreadyRegistered),
            NotRegistered(NotRegistered),
            IndexOutOfBounds(IndexOutOfBounds),
        }
    }

    #[derive(Debug, pvm_contract_sdk::SolError)]
    pub struct AlreadyRegistered;

    #[derive(Debug, pvm_contract_sdk::SolError)]
    pub struct NotRegistered;

    #[derive(Debug, pvm_contract_sdk::SolError)]
    pub struct IndexOutOfBounds;

    pub struct Leaderboard {
        #[slot(0)]
        player_count: Lazy<u64>,
        #[slot(1)]
        player_at: Mapping<u64, [u8; 20]>,
        #[slot(2)]
        is_registered: Mapping<[u8; 20], bool>,
        #[slot(3)]
        player_cid: Mapping<[u8; 20], String>,
        #[slot(4)]
        player_points: Mapping<[u8; 20], i64>,
    }

    impl Leaderboard {
        #[pvm_contract_sdk::constructor]
        pub fn new(&mut self) {
            self.player_count.set(&0);
        }

        #[pvm_contract_sdk::method]
        pub fn register(&mut self) -> Result<u64, Error> {
            let caller = self.caller();

            if self.is_registered.get(&caller.0) {
                return Err(AlreadyRegistered.into());
            }

            let idx = self.player_count.get();
            self.player_at.insert(&idx, &caller.0);
            self.is_registered.insert(&caller.0, &true);
            self.player_points.insert(&caller.0, &0);
            self.player_count.set(&(idx + 1));

            Ok(idx)
        }

        #[pvm_contract_sdk::method]
        pub fn update_result(&mut self, new_cid: String, points_delta: i64) -> Result<(), Error> {
            let caller = self.caller();

            if !self.is_registered.get(&caller.0) {
                return Err(NotRegistered.into());
            }

            self.player_cid.insert(&caller.0, &new_cid);

            let current = self.player_points.get(&caller.0);
            self.player_points.insert(&caller.0, &(current + points_delta));

            Ok(())
        }

        #[pvm_contract_sdk::method]
        pub fn get_player_count(&self) -> u64 {
            self.player_count.get()
        }

        #[pvm_contract_sdk::method]
        pub fn get_player_at(&self, index: u64) -> Result<Address, Error> {
            if index >= self.player_count.get() {
                return Err(IndexOutOfBounds.into());
            }
            Ok(Address(self.player_at.get(&index)))
        }

        #[pvm_contract_sdk::method]
        pub fn get_player_cid(&self, player: Address) -> String {
            self.player_cid.get(&player.0)
        }

        #[pvm_contract_sdk::method]
        pub fn get_player_points(&self, player: Address) -> i64 {
            self.player_points.get(&player.0)
        }

        #[pvm_contract_sdk::method]
        pub fn is_registered(&self, player: Address) -> bool {
            self.is_registered.get(&player.0)
        }

        fn caller(&self) -> Address {
            let mut buf = [0u8; 20];
            self.host().caller(&mut buf);
            Address(buf)
        }
    }
}
