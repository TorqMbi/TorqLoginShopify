"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

const slides = [
  {
    src: "/image1.jpg",
    alt: "TORQ ball bearing",
  },
  {
    src: "/image2.jpg",
    alt: "TORQ Bearings sealed industrial bearing",
  },
  {
    src: "/image3.jpg",
    alt: "TORQ sealed bearing",
  },
];

export function BearingCarousel() {
  const [position, setPosition] = useState(0);
  const [animate, setAnimate] = useState(true);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const interval = setInterval(() => {
      setPosition((current) => {
        if (current === 2) {
          setAnimate(true);
          return 3;
        }
        if (current === 3) {
          setAnimate(false);
          return 0;
        }
        setAnimate(true);
        return current + 1;
      });
    }, 4200);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (position !== 3) return;
    resetTimerRef.current = setTimeout(() => {
      setAnimate(false);
      setPosition(0);
    }, 1200);
    return () => {
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    };
  }, [position]);

  function selectSlide(index: number) {
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    setAnimate(true);
    setPosition(index);
  }

  return (
    <section className="landing-hero" aria-label="TORQ Bearings">
      <div
        className={`landing-hero-track${animate ? "" : " is-instant"}`}
        style={{ transform: `translateX(-${position * 25}%)` }}
      >
        {[...slides, slides[0]].map((slide, index) => (
          <div className="landing-hero-slide" key={`${slide.src}-${index}`}>
            <Image
              src={slide.src}
              alt={slide.alt}
              fill
              priority={index === 0}
              sizes="(max-width: 760px) 100vw, 600px"
            />
          </div>
        ))}
      </div>
      <div className="landing-carousel-dots" aria-label="Choose bearing image">
        {slides.map((slide, index) => (
          <button
            key={slide.src}
            type="button"
            className={position % 3 === index ? "active" : ""}
            aria-label={`Show bearing image ${index + 1}`}
            aria-current={position % 3 === index ? "true" : undefined}
            onClick={() => selectSlide(index)}
          />
        ))}
      </div>
    </section>
  );
}
