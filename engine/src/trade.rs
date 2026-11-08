//! Translated trade limits and reputation arithmetic.
//!
//! Provenance: supplied code hunk 0x6204..0x62f6 (limits),
//! 0x60f8..0x612c (purchase effect), 0x6170..0x6202 (sale effect).
//! These are isolated routines, not a complete market simulation.
//!
//! Authors: Christian Reitwiessner

use crate::Result;

#[derive(Clone, Copy, Debug)]
pub enum Mode {
    Buy,
    Sell,
}

/// DIVU.W retains the dividend when the quotient overflows 16 bits.
/// The original then masks to the low word without testing overflow.
fn original_divide(dividend: u32, divisor: u16) -> Result<u16> {
    if divisor == 0 {
        return Err("original DIVU.W would trap on division by zero".into());
    }
    let quotient = dividend / divisor as u32;
    Ok(if quotient > 0xffff {
        dividend as u16
    } else {
        quotient as u16
    })
}

pub fn quantity_limit(
    mode: Mode,
    market_stock: i16,
    inventory_stock: i16,
    buying_funds: i32,
    selling_funds: i32,
    buy_price: u16,
    sell_price: u16,
) -> Result<i32> {
    let (stock, funds, price, funds_usable) = match mode {
        Mode::Buy => (market_stock, buying_funds, buy_price, buying_funds > 0),
        Mode::Sell => (
            inventory_stock,
            selling_funds,
            sell_price,
            selling_funds >= 0,
        ),
    };
    if !funds_usable {
        return Ok(0);
    }
    Ok(i32::from(stock).min(i32::from(original_divide(funds as u32, price)?)))
}

pub fn purchase_reputation(
    current: i32,
    cost: u32,
    remaining_stock: i16,
    stock_parameter: u16,
    commodity: u16,
) -> i32 {
    let mut penalty = cost;
    if remaining_stock < (stock_parameter >> 6) as i16 {
        penalty = penalty.wrapping_shl(1);
    }
    if commodity <= 7 {
        penalty = penalty.wrapping_shl(1);
    }
    let result = (current as u32).wrapping_sub(penalty) as i32;
    if result < 0 { 0 } else { result }
}

pub fn sale_reputation(
    current: i32,
    proceeds: u32,
    new_stock: i16,
    quantity: i16,
    commodity: u16,
    rank: i16,
) -> i32 {
    if (8..=10).contains(&commodity) {
        if rank >= 7 {
            return (current as u32).wrapping_add(proceeds) as i32;
        }
        if rank >= 5 {
            return current;
        }
        let penalty = if rank >= 3 {
            proceeds
        } else {
            proceeds.wrapping_shl(1)
        };
        let result = (current as u32).wrapping_sub(penalty) as i32;
        return if result < 0 { 0 } else { result };
    }
    let mut benefit = proceeds;
    if commodity <= 3 {
        benefit = benefit.wrapping_shl(1);
    }
    if commodity <= 7 {
        benefit = benefit.wrapping_shl(1);
    }
    if new_stock == quantity {
        benefit = benefit.wrapping_shl(1);
    }
    (current as u32).wrapping_add(benefit) as i32
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn division_quirk_is_preserved() {
        assert_eq!(
            quantity_limit(Mode::Buy, 30_000, 0, 1_000_000, 0, 1, 1).unwrap(),
            16_960
        );
        assert_eq!(quantity_limit(Mode::Buy, 100, 0, 0, 0, 0, 0).unwrap(), 0);
        assert!(quantity_limit(Mode::Buy, 100, 0, 1, 0, 0, 0).is_err());
    }
}
